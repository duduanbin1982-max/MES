"use strict";
// services/process/node/nodeCrud.js
// 工艺节点 CRUD + 实例工艺树
//   GET    /api/equipment_instances/:id/process_tree
//   POST   /api/process_nodes
//   PUT    /api/process_nodes/:id
//   DELETE /api/process_nodes/:id
//   GET    /api/process_nodes/:id
// Author: 三狗子 | Date: 2026-06-24

const { all, get, run, wrap } = require("./_helpers");
const { emit, Events } = require("../../../app/ws/EventBus");

function register(app, db) {
app.get('/api/equipment_instances/:id/process_tree', wrap((req, res) => {
  const rows = all( db, 'SELECT * FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sort_order, id', req.params.id);
  const bomMap = {};
  all( db, 'SELECT id, material_id, quantity, is_key_component FROM instance_bom WHERE equipment_instance_id = ?', req.params.id)
    .forEach((b) => bomMap[b.id] = b);
  const matMap = {};
  all( db, 'SELECT id, material_name FROM materials').forEach((m) => matMap[m.id] = m);
  const wsMap = {};
  all( db, 'SELECT id, name FROM workstations').forEach((w) => wsMap[w.id] = w);
  const deps = all( db, 'SELECT * FROM process_dependencies WHERE equipment_instance_id = ?', req.params.id);
  const enriched = rows.map((n) => {
    const bom = n.bom_node_id ? bomMap[n.bom_node_id] : null;
    const mat = bom && bom.material_id ? matMap[bom.material_id] : null;
    return Object.assign({}, n, {
      bom_quantity: bom ? bom.quantity : null,
      bom_is_key: bom ? !!bom.is_key_component : false,
      material_name: mat ? mat.material_name : null,
      workstation_name: n.required_workstation_id ? wsMap[n.required_workstation_id] : null,
      predecessors: deps.filter((d) => d.successor_id === n.id).map((d) => d.predecessor_id),
      successors: deps.filter((d) => d.predecessor_id === n.id).map((d) => d.successor_id)
    });
  });
  const map = {};
  enriched.forEach((n) => { n.children = []; map[n.id] = n; });
  const roots = [];
  enriched.forEach((n) => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(n);
    else roots.push(n);
  });
  res.json({ flat: enriched, tree: roots, deps: deps });
}));

// 工艺节点 CRUD
app.post('/api/process_nodes', wrap((req, res) => {
  const { equipment_instance_id, parent_id, bom_node_id, operation_name, operation_type,
          sequence, estimated_hours, required_workstation_id, required_skill,
          operation_template_id, required_position_code, worker_count, qc_required, sop_required,
          is_milestone, phase_code, planned_start, planned_end, notes } = req.body;
  if (!equipment_instance_id || !operation_name) return res.status(400).json({ error: 'equipment_instance_id/operation_name 必填' });
  const r = run( db, 
    "INSERT INTO process_nodes (equipment_instance_id, parent_id, bom_node_id, operation_name, operation_type, sequence, estimated_hours, required_workstation_id, required_skill, operation_template_id, required_position_code, worker_count, qc_required, sop_required, is_milestone, phase_code, planned_start, planned_end, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [equipment_instance_id, parent_id || null, bom_node_id || null, operation_name, operation_type || 'make',
     sequence || 1, estimated_hours || 0, required_workstation_id || null, required_skill || null,
     operation_template_id || null, required_position_code || null, worker_count || 1, qc_required ? 1 : 0, sop_required ? 1 : 0,
     is_milestone ? 1 : 0, phase_code || null, planned_start || null, planned_end || null, notes || null]
  );
  emit(Events.BOM_CREATED, { node_id: r.lastInsertRowid, node_name: operation_name, equipment_instance_id, parent_id, bom_node_id });
  res.json({ id: r.lastInsertRowid, message: '工艺节点已创建' });
}));

app.put('/api/process_nodes/:id', wrap((req, res) => {
  const fields = ['operation_name', 'operation_type', 'sequence', 'estimated_hours',
                  'required_workstation_id', 'required_skill', 'operation_template_id', 'required_position_code',
                  'worker_count', 'qc_required', 'sop_required', 'is_milestone', 'phase_code',
                  'planned_start', 'planned_end', 'actual_start', 'actual_end',
                  'planned_cost', 'actual_cost', 'status', 'sort_order', 'notes', 'parent_id', 'bom_node_id'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(f + ' = ?'); values.push(req.body[f]); }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no fields' });
  const nodeBefore = get(db, 'SELECT id, equipment_instance_id, operation_name FROM process_nodes WHERE id = ?', req.params.id);
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const r = run( db, 'UPDATE process_nodes SET ' + updates.join(', ') + ' WHERE id = ?', values);
  if (nodeBefore) emit(Events.BOM_UPDATED, { node_id: nodeBefore.id, node_name: req.body.operation_name || nodeBefore.operation_name, equipment_instance_id: nodeBefore.equipment_instance_id, action: "updated" });
  res.json({ changes: r.changes, message: '已更新' });
}));

app.delete('/api/process_nodes/:id', wrap((req, res) => {
  const nodeBefore = get(db, 'SELECT id, equipment_instance_id, operation_name FROM process_nodes WHERE id = ?', req.params.id);
  const r = run( db, 'DELETE FROM process_nodes WHERE id = ?', req.params.id);
  if (nodeBefore) emit(Events.BOM_UPDATED, { node_id: nodeBefore.id, node_name: nodeBefore.operation_name, equipment_instance_id: nodeBefore.equipment_instance_id, action: "deleted" });
  res.json({ changes: r.changes, message: '已删除' });
}));

app.get('/api/process_nodes/:id', wrap((req, res) => {
  const n = get( db, 'SELECT * FROM process_nodes WHERE id = ?', req.params.id);
  if (!n) return res.status(404).json({ error: 'not found' });
  n.executions = all( db, 'SELECT pe.*, u.full_name as operator_name FROM process_executions pe LEFT JOIN users u ON pe.operator_id = u.id WHERE pe.process_node_id = ? ORDER BY pe.timestamp', req.params.id);
  n.predecessors = all( db, 'SELECT * FROM process_dependencies WHERE successor_id = ?', req.params.id);
  n.successors = all( db, 'SELECT * FROM process_dependencies WHERE predecessor_id = ?', req.params.id);
  res.json(n);
}));

// 工艺执行 (扫码报工)
}

module.exports = { register };
