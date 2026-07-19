"use strict";

const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      user_id INTEGER,
      workstation_id INTEGER,
      planned_start TEXT,
      planned_end TEXT,
      estimated_hours REAL,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'planned',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (process_node_id) REFERENCES process_nodes(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workstation_id) REFERENCES workstations(id)
    )
  `);

  db.exec(`
    DELETE FROM schedule_assignments
    WHERE status IN ('assigned', 'in_progress', 'pending')
      AND id NOT IN (
        SELECT MAX(id)
        FROM schedule_assignments
        WHERE status IN ('assigned', 'in_progress', 'pending')
        GROUP BY process_node_id
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_assignments_active_node
      ON schedule_assignments(process_node_id)
      WHERE status IN ('assigned', 'in_progress', 'pending');
    CREATE INDEX IF NOT EXISTS idx_schedule_assignments_user_status
      ON schedule_assignments(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_schedule_assignments_workstation_dates
      ON schedule_assignments(workstation_id, planned_start, planned_end);
  `);
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  return value ? String(value).slice(0, 19) : null;
}

function register(app, db) {
  runMigration(db);

  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  app.get("/api/schedule/weekly", wrap((req, res) => {
    const refValue = req.query.date || req.query.week;
    const ref = refValue ? new Date(String(refValue).slice(0, 10) + "T00:00:00") : new Date();
    if (Number.isNaN(ref.getTime())) throw ApiError.validation("Invalid date format, use YYYY-MM-DD");

    const day = ref.getDay();
    const monday = new Date(ref);
    monday.setDate(ref.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd = sunday.toISOString().slice(0, 10);

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
      WHERE (pn.planned_start <= ? AND pn.planned_end >= ?)
         OR pn.status IN ('pending', 'in_progress', 'blocked', 'delayed')
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
    };

    res.json({ week_start: weekStart, week_end: weekEnd, equipment, equipment_instances: equipment, summary });
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

    res.json({ ok: true, process_node_id: nodeId, user_id: userId, assignment_id: assignmentId, status: nextStatus });
  }));

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

  console.log("[scheduleService] Dispatch scheduling registered");
}

module.exports = { register };
