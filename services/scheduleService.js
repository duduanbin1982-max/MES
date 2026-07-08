'use strict';
const { ApiError } = require('../app/errors');
const { wrap } = require('../middleware/asyncHandler');

// ===== Migration =====
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
}

// ===== Register =====
function register(app, db) {
  runMigration(db);

  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  // --- 1. GET /api/schedule/weekly?date=2026-06-26 ---
  app.get('/api/schedule/weekly', wrap((req, res) => {
    const { date } = req.query;
    const ref = date ? new Date(date + 'T00:00:00') : new Date();
    if (isNaN(ref.getTime())) throw ApiError.validation('Invalid date format, use YYYY-MM-DD');

    const day = ref.getDay();
    const monday = new Date(ref);
    monday.setDate(ref.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd = sunday.toISOString().slice(0, 10);

    const nodes = all(`
      SELECT pn.id, pn.operation_name, pn.status, pn.planned_start, pn.planned_end,
             pn.estimated_hours, pn.phase_code, pn.equipment_instance_id,
             u.full_name AS assigned_name,
             w.name AS workstation_name
      FROM process_nodes pn
      LEFT JOIN users u ON pn.assigned_to = u.id
      LEFT JOIN workstations w ON pn.required_workstation_id = w.id
      WHERE (pn.planned_start <= ? AND pn.planned_end >= ?)
         OR pn.status IN ('pending', 'in_progress')
      ORDER BY pn.equipment_instance_id, pn.planned_start
    `, weekEnd, weekStart);

    const equipMap = {};
    for (const n of nodes) {
      const eid = n.equipment_instance_id;
      if (!equipMap[eid]) equipMap[eid] = { nodes: [] };
      equipMap[eid].nodes.push(n);
    }

    const equipment = [];
    for (const [eid, group] of Object.entries(equipMap)) {
      const inst = get('SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?', eid);
      const total = group.nodes.length;
      const completed = group.nodes.filter(n => n.status === 'completed').length;
      equipment.push({
        instance_id: inst ? inst.id : parseInt(eid),
        instance_code: inst ? inst.instance_code : 'N/A',
        instance_name: inst ? inst.instance_name : 'N/A',
        progress_pct: total > 0 ? Math.round((completed / total) * 100) : 0,
        nodes: group.nodes,
      });
    }

    const summary = {
      total_nodes: nodes.length,
      completed: nodes.filter(n => n.status === 'completed').length,
      in_progress: nodes.filter(n => n.status === 'in_progress').length,
      pending: nodes.filter(n => n.status === 'pending').length,
      delayed: nodes.filter(n => n.status === 'delayed' || n.status === 'blocked').length,
    };

    res.json({ week_start: weekStart, week_end: weekEnd, equipment, summary });
  }));

  // --- 2. PUT /api/schedule/process-nodes/:id/assign ---
  app.put('/api/schedule/process-nodes/:id/assign', wrap((req, res) => {
    const nodeId = parseInt(req.params.id, 10);
    const { user_id, planned_start, planned_end, workstation_id } = req.body || {};

    if (!user_id) throw ApiError.validation('user_id is required');

    const node = get('SELECT id, status, estimated_hours FROM process_nodes WHERE id = ?', nodeId);
    if (!node) throw ApiError.notFound('Process node not found');

    run(`UPDATE process_nodes
         SET assigned_to = ?, planned_start = ?, planned_end = ?,
             status = 'in_progress', updated_at = datetime('now')
         WHERE id = ?`,
      user_id, planned_start || null, planned_end || null, nodeId);

    const result = run(`INSERT INTO schedule_assignments
      (process_node_id, user_id, workstation_id, planned_start, planned_end, estimated_hours, status)
      VALUES (?, ?, ?, ?, ?, ?, 'assigned')`,
      nodeId, user_id, workstation_id || null,
      planned_start || null, planned_end || null,
      node.estimated_hours || 0);

    res.json({
      ok: true,
      process_node_id: nodeId,
      user_id,
      assignment_id: result.lastInsertRowid,
    });
  }));

  // --- 3. PUT /api/schedule/process-nodes/:id/status ---
  app.put('/api/schedule/process-nodes/:id/status', wrap((req, res) => {
    const nodeId = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'delayed'];

    if (!status || !validStatuses.includes(status)) {
      throw ApiError.validation(`status must be one of: ${validStatuses.join(', ')}`);
    }

    const node = get('SELECT id FROM process_nodes WHERE id = ?', nodeId);
    if (!node) throw ApiError.notFound('Process node not found');

    const updates = ['status = ?', "updated_at = datetime('now')"];
    const params = [status];

    if (status === 'completed') {
      updates.push("actual_end = datetime('now')");
    }

    params.push(nodeId);
    run(`UPDATE process_nodes SET ${updates.join(', ')} WHERE id = ?`, ...params);

    run(`UPDATE schedule_assignments SET status = ?, updated_at = datetime('now')
         WHERE process_node_id = ? AND status = 'assigned'`,
      status, nodeId);

    res.json({ ok: true, process_node_id: nodeId, status });
  }));

  // --- 4. GET /api/schedule/capacity?workstation_id=X&date=YYYY-MM-DD ---
  app.get('/api/schedule/capacity', wrap((req, res) => {
    const { workstation_id, date } = req.query;
    if (!workstation_id) throw ApiError.validation('workstation_id is required');
    if (!date) throw ApiError.validation('date is required (YYYY-MM-DD)');

    const ws = get('SELECT id, name, capacity_per_day FROM workstations WHERE id = ? AND is_active = 1', workstation_id);
    if (!ws) throw ApiError.notFound('Workstation not found or inactive');

    const capacityHours = (ws.capacity_per_day || 1) * 8;

    const result = get(`
      SELECT COALESCE(SUM(sa.estimated_hours), 0) AS assigned_hours
      FROM schedule_assignments sa
      WHERE sa.workstation_id = ?
        AND sa.planned_start <= ? AND sa.planned_end >= ?
        AND sa.status IN ('assigned', 'in_progress')
    `, workstation_id, date, date);

    const assignedHours = result ? result.assigned_hours : 0;
    const availableHours = Math.max(0, capacityHours - assignedHours);

    res.json({
      workstation_name: ws.name,
      capacity_hours: capacityHours,
      assigned_hours: assignedHours,
      available_hours: availableHours,
      can_accept: availableHours > 0,
    });
  }));

  // --- 5. GET /api/schedule/daily?date=YYYY-MM-DD ---
  app.get('/api/schedule/daily', wrap((req, res) => {
    const { date } = req.query;
    if (!date) throw ApiError.validation('date is required (YYYY-MM-DD)');

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
      WHERE pn.planned_start <= ? AND pn.planned_end >= ?
         OR pn.status IN ('in_progress')
      ORDER BY pn.required_workstation_id, pn.planned_start
    `, date, date);

    const wsMap = {};
    for (const n of nodes) {
      const key = n.required_workstation_id || 'unassigned';
      if (!wsMap[key]) {
        wsMap[key] = {
          workstation_id: n.required_workstation_id || null,
          workstation_name: n.workstation_name || 'Unassigned',
          nodes: [],
        };
      }
      wsMap[key].nodes.push(n);
    }

    res.json({ date, workstations: Object.values(wsMap) });
  }));

  // --- 6. GET /api/schedule/my-tasks ---
  app.get('/api/schedule/my-tasks', wrap((req, res) => {
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

    const merged = [...tasks, ...directNodes];
    const seen = new Set();
    const unique = merged.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    unique.sort((a, b) => (a.priority || 1) - (b.priority || 1) ||
      (a.planned_start || '').localeCompare(b.planned_start || ''));

    res.json({ tasks: unique });
  }));

  console.log('[scheduleService] Dispatch scheduling registered');
}

module.exports = { register };
