"use strict";
// services/process/node/nodeActions.js
// 工艺节点业务动作 (5 个端点)
//   POST /api/process_nodes/:id/execute    执行工序 (写实际工时/状态)
//   POST /api/equipment_instances/:id/auto_unlock  批量解锁
//   PUT  /api/process_nodes/:id/move       调整顺序
//   PUT  /api/process_nodes/:id/assign     分配工人
//   GET  /api/process_nodes/:id/efficiency 效率统计
// Author: 三狗子 | Date: 2026-06-24

const { all, get, run, wrap, autoUnlockSuccessors } = require("./_helpers");

function register(app, db) {
app.post('/api/process_nodes/:id/execute', wrap((req, res) => {
  const { operator_id, action, hours_worked, result, notes, photos } = req.body;
  const t = db.transaction(() => {
    const r = run( db, 
      "INSERT INTO process_executions (process_node_id, operator_id, action, hours_worked, result, notes, photos) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.params.id, operator_id || null, action, hours_worked || 0, result || null, notes || null,
       photos ? JSON.stringify(photos) : null]
    );
    if (action === 'start') {
      run( db, "UPDATE process_nodes SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')), updated_at = datetime('now') WHERE id = ?", req.params.id);
    } else if (action === 'complete' || action === 'qc') {
      run( db, "UPDATE process_nodes SET status = 'completed', actual_end = COALESCE(actual_end, datetime('now')), updated_at = datetime('now') WHERE id = ?", req.params.id);
      if (action === 'complete' || (action === 'qc' && result === 'pass')) {
        const node = get( db, 'SELECT equipment_instance_id FROM process_nodes WHERE id = ?', req.params.id);
        if (node) autoUnlockSuccessors( db, req.params.id, node.equipment_instance_id);
      }
    } else if (action === 'pause') {
      run( db, "UPDATE process_nodes SET status = 'paused', updated_at = datetime('now') WHERE id = ?", req.params.id);
    } else if (action === 'block') {
      run( db, "UPDATE process_nodes SET status = 'blocked', updated_at = datetime('now') WHERE id = ?", req.params.id);
    }
    return r;
  });
  const r = t();
  res.json({ id: r.lastInsertRowid, message: '执行已记录' });
}));


app.post('/api/equipment_instances/:id/auto_unlock', wrap((req, res) => {
  const allNodes = all( db, 'SELECT id, status FROM process_nodes WHERE equipment_instance_id = ?', req.params.id);
  let unlocked = 0;
  for (const n of allNodes) {
    if (n.status !== 'pending') continue;
    const hasPred = get( db, 'SELECT 1 as x FROM process_dependencies WHERE successor_id = ? LIMIT 1', n.id);
    if (!hasPred) {
      run( db, "UPDATE process_nodes SET status = 'ready', updated_at = datetime('now') WHERE id = ?", n.id);
      unlocked++;
    }
  }
  res.json({ unlocked: unlocked, message: '已解锁 ' + unlocked + ' 个根节点' });
}));

// 依赖管理

app.put('/api/process_nodes/:id/move', wrap((req, res) => {
  const { parent_id } = req.body;
  const r = run( db, "UPDATE process_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?", [parent_id || null, req.params.id]);
  res.json({ changes: r.changes });
}));


app.put('/api/process_nodes/:id/assign', wrap((req, res) => {
  const { assigned_to, required_workstation_id } = req.body;
  const updates = [];
  const values = [];
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
  if (required_workstation_id !== undefined) { updates.push('required_workstation_id = ?'); values.push(required_workstation_id); }
  if (updates.length === 0) return res.status(400).json({ error: 'no fields' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const r = run( db, 'UPDATE process_nodes SET ' + updates.join(', ') + ' WHERE id = ?', values);
  res.json({ changes: r.changes });
}));



app.get('/api/process_nodes/:id/efficiency', wrap((req, res) => {
  const node = get( db, 'SELECT id, operation_name, estimated_hours FROM process_nodes WHERE id = ?', req.params.id);
  if (!node) return res.status(404).json({ error: 'not found' });
  const actual = get( db, "SELECT COALESCE(SUM(hours_worked), 0) h FROM process_executions WHERE process_node_id = ? AND action IN ('start', 'complete')", req.params.id);
  res.json({
    node_id: node.id,
    operation_name: node.operation_name,
    estimated_hours: node.estimated_hours || 0,
    actual_hours: actual?.h || 0,
    efficiency_pct: node.estimated_hours ? Math.round((node.estimated_hours / (actual?.h || 1)) * 100) : 0,
    variance: (actual?.h || 0) - (node.estimated_hours || 0)
  });
}));

// P2-#8 工艺参数记录
}

module.exports = { register };
