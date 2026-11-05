"use strict";
// services/schedule/routes.js 的路由组 1

module.exports = function registerRoutes1(app, db, ctx) {
const { ApiError } = require("../../../app/errors");
const { toInt, normalizeDate } = require("../_helpers");
const { wrap } = require("../../../middleware/asyncHandler");
const { all, get, run } = ctx;

  app.get("/api/schedule/weekly", wrap((req, res) => {
    const refValue = req.query.date || req.query.week;
    const ref = refValue ? new Date(String(refValue).slice(0, 10) + "T00:00:00") : new Date();
    if (Number.isNaN(ref.getTime())) throw ApiError.validation("Invalid date format, use YYYY-MM-DD");
    ref.setHours(0, 0, 0, 0);

    // 2026-11-05（审计 F-01）：周窗口按本地日期格式化。
    // 原实现用 toISOString()（UTC），东八区会把周一 00:00 变成周日 16:00，导致周窗口整体偏移 1 天。
    const pad = (value) => String(value).padStart(2, "0");
    const formatLocalDate = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const day = ref.getDay();
    const monday = new Date(ref);
    monday.setDate(ref.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStart = formatLocalDate(monday);
    const weekEnd = formatLocalDate(sunday);

    // 2026-11-05（审计 F-02）：只返回"本周计划 + 未排程"。
    // 原实现 `OR status IN (...)` 会把所有未完成节点都带出来（等于整个 back log），
    // 前端再据此算完成率/项目进度，导致 KPI 与表格口径都失真。
    const nodes = all(`
      SELECT pn.id, pn.sequence, pn.operation_name, pn.status, pn.planned_start, pn.planned_end,
             pn.estimated_hours, pn.phase_code, pn.equipment_instance_id,
             pn.assigned_to AS assigned_id,
             pn.required_workstation_id AS workstation_id,
             u.full_name AS assigned_name,
             w.name AS workstation_name
      FROM process_nodes pn
      LEFT JOIN users u ON pn.assigned_to = u.id
      LEFT JOIN workstations w ON pn.required_workstation_id = w.id
      WHERE (date(pn.planned_start) <= date(?) AND date(pn.planned_end) >= date(?))
         OR pn.planned_start IS NULL
         OR pn.planned_end IS NULL
      ORDER BY pn.equipment_instance_id, COALESCE(pn.planned_start, '9999-12-31'), pn.sequence, pn.id
    `, weekEnd, weekStart);

    const equipMap = {};
    for (const node of nodes) {
      const equipmentId = node.equipment_instance_id;
      if (!equipMap[equipmentId]) equipMap[equipmentId] = { nodes: [] };
      equipMap[equipmentId].nodes.push(node);
    }

    const equipment = [];
    for (const [equipmentId, group] of Object.entries(equipMap)) {
      const instance = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", equipmentId);
      const total = group.nodes.length;
      const completed = group.nodes.filter((node) => node.status === "completed").length;
      const item = {
        id: instance ? instance.id : Number.parseInt(equipmentId, 10),
        instance_id: instance ? instance.id : Number.parseInt(equipmentId, 10),
        instance_code: instance ? instance.instance_code : "N/A",
        instance_name: instance ? instance.instance_name : "N/A",
        progress_pct: total > 0 ? Math.round((completed / total) * 100) : 0,
        nodes: group.nodes,
        process_nodes: group.nodes,
      };
      equipment.push(item);
    }

    const summary = {
      total: nodes.length,
      total_nodes: nodes.length,
      completed: nodes.filter((node) => node.status === "completed").length,
      in_progress: nodes.filter((node) => node.status === "in_progress").length,
      pending: nodes.filter((node) => node.status === "pending" || !node.status).length,
      delayed: nodes.filter((node) => node.status === "delayed" || node.status === "blocked").length,
      unscheduled: nodes.filter((node) => !node.planned_start || !node.planned_end).length,
    };

    res.json({
      week_start: weekStart,
      week_end: weekEnd,
      scope: "week+unscheduled",
      equipment,
      equipment_instances: equipment,
      summary,
    });
  }));

  app.put("/api/schedule/process-nodes/:id/assign", wrap((req, res) => {
    const nodeId = toInt(req.params.id);
    const body = req.body || {};
    const userId = toInt(body.user_id || body.assigned_id);
    const workstationId = body.workstation_id ? toInt(body.workstation_id) : null;

    if (!nodeId) throw ApiError.validation("process node id is required");
    if (!userId) throw ApiError.validation("user_id is required");

    const node = get("SELECT id, status, estimated_hours FROM process_nodes WHERE id = ?", nodeId);
    if (!node) throw ApiError.notFound("Process node not found");

    const user = get("SELECT id FROM users WHERE id = ? AND is_active = 1", userId);
    if (!user) throw ApiError.notFound("Worker not found or inactive");

    if (workstationId) {
      const workstation = get("SELECT id FROM workstations WHERE id = ? AND is_active = 1", workstationId);
      if (!workstation) throw ApiError.notFound("Workstation not found or inactive");
    }

    // 2026-11-05（审计 F-06）：派工前做资质校验（技能 / 证书 / 文档签收），与工艺树派工同一套规则。
    // force=true 时只告警不阻断（应急派工），并把校验结果写进响应。
    const { validateAssignment } = require("../../../shared/assignmentValidation");
    const validation = validateAssignment(db, { process_node_id: nodeId, user_id: userId });
    if (!validation.ok && body.force !== true) {
      throw ApiError.validation("人员资质不满足该工序要求（可勾选强制派工）", validation);
    }

    const plannedStart = normalizeDate(body.planned_start);
    const plannedEnd = normalizeDate(body.planned_end);
    const nextStatus = node.status || "pending";

    run(`UPDATE process_nodes
         SET assigned_to = ?,
             planned_start = COALESCE(?, planned_start),
             planned_end = COALESCE(?, planned_end),
             required_workstation_id = COALESCE(?, required_workstation_id),
             status = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      userId, plannedStart, plannedEnd, workstationId, nextStatus, nodeId);

    const existing = get(`
      SELECT id
      FROM schedule_assignments
      WHERE process_node_id = ? AND status IN ('assigned', 'in_progress', 'pending')
      ORDER BY id DESC
      LIMIT 1
    `, nodeId);

    let assignmentId;
    if (existing) {
      run(`UPDATE schedule_assignments
           SET user_id = ?, workstation_id = ?, planned_start = ?, planned_end = ?,
               estimated_hours = ?, status = 'assigned', updated_at = datetime('now')
           WHERE id = ?`,
        userId, workstationId, plannedStart, plannedEnd, node.estimated_hours || 0, existing.id);
      assignmentId = existing.id;
    } else {
      const result = run(`INSERT INTO schedule_assignments
        (process_node_id, user_id, workstation_id, planned_start, planned_end, estimated_hours, status)
        VALUES (?, ?, ?, ?, ?, ?, 'assigned')`,
        nodeId, userId, workstationId, plannedStart, plannedEnd, node.estimated_hours || 0);
      assignmentId = result.lastInsertRowid;
    }

    res.json({ ok: true, process_node_id: nodeId, user_id: userId, validation, assignment_id: assignmentId, status: nextStatus });
  }));
};
