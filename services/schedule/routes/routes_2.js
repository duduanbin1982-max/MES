"use strict";
// services/schedule/routes.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { ApiError } = require("../../../app/errors");
const { makeDbHelpers, toInt, normalizeDate } = require("../_helpers");
const { wrap } = require("../../../middleware/asyncHandler");
const { all, get, run } = ctx;

  app.put("/api/schedule/process-nodes/:id/status", wrap((req, res) => {
    const nodeId = toInt(req.params.id);
    const { status } = req.body || {};
    const validStatuses = ["pending", "in_progress", "completed", "blocked", "delayed"];

    if (!nodeId) throw ApiError.validation("process node id is required");
    if (!status || !validStatuses.includes(status)) {
      throw ApiError.validation(`status must be one of: ${validStatuses.join(", ")}`);
    }

    const node = get("SELECT id FROM process_nodes WHERE id = ?", nodeId);
    if (!node) throw ApiError.notFound("Process node not found");

    const updates = ["status = ?", "updated_at = datetime('now')"];
    const params = [status];

    if (status === "in_progress") {
      updates.push("actual_start = COALESCE(actual_start, ?)");
      params.push(normalizeDate(req.body.actual_start) || new Date().toISOString().slice(0, 19));
    }

    if (status === "completed") {
      updates.push("actual_start = COALESCE(actual_start, ?)");
      updates.push("actual_end = ?");
      params.push(normalizeDate(req.body.actual_start) || new Date().toISOString().slice(0, 19));
      params.push(normalizeDate(req.body.actual_end) || new Date().toISOString().slice(0, 19));
    }

    params.push(nodeId);
    run(`UPDATE process_nodes SET ${updates.join(", ")} WHERE id = ?`, ...params);

    run(`UPDATE schedule_assignments
         SET status = ?, updated_at = datetime('now')
         WHERE process_node_id = ? AND status IN ('assigned', 'in_progress', 'pending')`,
      status, nodeId);

    res.json({ ok: true, process_node_id: nodeId, status });
  }));

  app.get("/api/schedule/capacity", wrap((req, res) => {
    const { workstation_id, date } = req.query;
    if (!workstation_id) throw ApiError.validation("workstation_id is required");
    if (!date) throw ApiError.validation("date is required (YYYY-MM-DD)");

    const workstation = get("SELECT id, name, capacity_per_day FROM workstations WHERE id = ? AND is_active = 1", workstation_id);
    if (!workstation) throw ApiError.notFound("Workstation not found or inactive");

    const capacityHours = (workstation.capacity_per_day || 1) * 8;
    const result = get(`
      SELECT COALESCE(SUM(estimated_hours), 0) AS assigned_hours
      FROM schedule_assignments
      WHERE workstation_id = ?
        AND planned_start <= ? AND planned_end >= ?
        AND status IN ('assigned', 'in_progress')
    `, workstation_id, date, date);

    const assignedHours = result ? result.assigned_hours : 0;
    res.json({
      workstation_name: workstation.name,
      capacity_hours: capacityHours,
      assigned_hours: assignedHours,
      available_hours: Math.max(0, capacityHours - assignedHours),
      can_accept: capacityHours - assignedHours > 0,
    });
  }));

  app.get("/api/schedule/daily", wrap((req, res) => {
    const { date } = req.query;
    if (!date) throw ApiError.validation("date is required (YYYY-MM-DD)");

    const nodes = all(`
      SELECT pn.id, pn.operation_name, pn.status, pn.planned_start, pn.planned_end,
             pn.estimated_hours, pn.phase_code, pn.equipment_instance_id,
             pn.required_workstation_id,
             u.full_name AS assigned_name,
             w.name AS workstation_name,
             ei.instance_code, ei.instance_name
      FROM process_nodes pn
      LEFT JOIN users u ON pn.assigned_to = u.id
      LEFT JOIN workstations w ON pn.required_workstation_id = w.id
      LEFT JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
      WHERE (pn.planned_start <= ? AND pn.planned_end >= ?)
         OR pn.status IN ('in_progress')
      ORDER BY pn.required_workstation_id, pn.planned_start
    `, date, date);

    const workstationMap = {};
    for (const node of nodes) {
      const key = node.required_workstation_id || "unassigned";
      if (!workstationMap[key]) {
        workstationMap[key] = {
          workstation_id: node.required_workstation_id || null,
          workstation_name: node.workstation_name || "未分配",
          nodes: [],
        };
      }
      workstationMap[key].nodes.push(node);
    }

    res.json({ date, workstations: Object.values(workstationMap) });
  }));

  app.get("/api/schedule/my-tasks", wrap((req, res) => {
    const userId = req.user && req.user.sub;
    if (!userId) throw ApiError.unauthorized();

    const tasks = all(`
      SELECT pn.id, pn.operation_name, pn.status, pn.planned_start, pn.planned_end,
             pn.estimated_hours, pn.phase_code, pn.actual_start, pn.actual_end,
             ei.instance_code, ei.instance_name,
             w.name AS workstation_name,
             sa.priority
      FROM process_nodes pn
      JOIN schedule_assignments sa ON sa.process_node_id = pn.id AND sa.user_id = ?
      LEFT JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
      LEFT JOIN workstations w ON pn.required_workstation_id = w.id
      WHERE pn.status IN ('pending', 'in_progress')
      ORDER BY sa.priority ASC, pn.planned_start ASC
    `, userId);

    const directNodes = all(`
      SELECT pn.id, pn.operation_name, pn.status, pn.planned_start, pn.planned_end,
             pn.estimated_hours, pn.phase_code, pn.actual_start, pn.actual_end,
             ei.instance_code, ei.instance_name,
             w.name AS workstation_name,
             1 AS priority
      FROM process_nodes pn
      LEFT JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
      LEFT JOIN workstations w ON pn.required_workstation_id = w.id
      WHERE pn.assigned_to = ?
        AND pn.status IN ('pending', 'in_progress')
        AND pn.id NOT IN (SELECT process_node_id FROM schedule_assignments WHERE user_id = ?)
      ORDER BY pn.planned_start ASC
    `, userId, userId);

    const seen = new Set();
    const unique = [...tasks, ...directNodes].filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
    unique.sort((a, b) => (a.priority || 1) - (b.priority || 1) || (a.planned_start || "").localeCompare(b.planned_start || ""));

    res.json({ tasks: unique });
  }));
};
