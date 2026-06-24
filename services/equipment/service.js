// services/equipmentService.js
// P0-#1 拆 server.js: 整机/型号/子系统/工位/设备实时状态 (P2-#3 设备看板)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

// ============================================================
// ============================================================
app.get('/api/equipment_instances', wrap((req, res) => {
  const { status, customer, equipment_type_id } = req.query;
  let sql = "SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
  const params = [];
  if (status) { sql += ' AND ei.status = ?'; params.push(status); }
  if (customer) { sql += ' AND ei.customer_name LIKE ?'; params.push('%' + customer + '%'); }
  if (equipment_type_id) { sql += ' AND em.equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY ei.created_at DESC';
  res.json(all(sql, params));
}));

app.get('/api/equipment_instances/:id', wrap((req, res) => {
  const row = get("SELECT ei.*, em.model_code, em.model_name, em.diameter_mm, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
}));

app.post('/api/equipment_instances', wrap((req, res) => {
  const { instance_code, instance_name, equipment_model_id, customer_name, customer_contact, site_location, contract_no, contract_amount, start_date, planned_start, planned_end, serial_no, notes } = req.body;
  if (!instance_code || !customer_name) return res.status(400).json({ error: 'instance_code/customer_name 必填' });
  const r = run(
    "INSERT INTO equipment_instances (instance_code, instance_name, equipment_model_id, customer_name, customer_contact, site_location, contract_no, contract_amount, start_date, planned_start, planned_end, serial_no, lifecycle_stage, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [instance_code, instance_name || null, equipment_model_id || null, customer_name, customer_contact || null, site_location || null, contract_no || null, contract_amount || null, start_date || null, planned_start || null, planned_end || null, serial_no || null, 'S1', notes || null]
  );
  res.json({ id: r.lastInsertRowid, message: '整机实例已创建', lifecycle_stage: 'S1' });
}));

app.put('/api/equipment_instances/:id', wrap((req, res) => {
  const fields = ['instance_name', 'equipment_model_id', 'customer_name', 'customer_contact', 'site_location', 'contract_no', 'contract_amount', 'start_date', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'status', 'lifecycle_stage', 'progress_pct', 'serial_no', 'notes'];
  const updates = [];
  const values = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(f + ' = ?'); values.push(req.body[f]); }
  if (updates.length === 0) return res.status(400).json({ error: 'no fields' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const r = run('UPDATE equipment_instances SET ' + updates.join(', ') + ' WHERE id = ?', values);
  res.json({ changes: r.changes });
}));

app.delete('/api/equipment_instances/:id', wrap((req, res) => {
  const r = run('DELETE FROM equipment_instances WHERE id = ?', req.params.id);
  res.json({ changes: r.changes });
}));

app.get('/api/equipment_instances/:id/dashboard', wrap((req, res) => {
  const inst = get("SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?", req.params.id);
  if (!inst) return res.status(404).json({ error: 'not found' });
  const wo_stats = get("SELECT count(*) as total, sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, sum(CASE WHEN status = 'issue' THEN 1 ELSE 0 END) as issue FROM work_orders WHERE equipment_instance_id = ?", req.params.id);
  const pn_stats = get("SELECT count(*) as total, sum(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM process_nodes WHERE equipment_instance_id = ?", req.params.id);
  res.json({ instance: inst, work_orders: wo_stats, process_nodes: pn_stats, bom_count: get('SELECT count(*) c FROM instance_bom WHERE equipment_instance_id = ?', req.params.id).c });
}));

// ============================================================
// 装备类型 / 型号 / 子系统 / 工位
// ============================================================
app.get('/api/equipment_types', wrap((req, res) => res.json(all('SELECT * FROM equipment_types WHERE is_active = 1 ORDER BY id'))));
app.get('/api/equipment_types/:id', wrap((req, res) => {
  const r = get('SELECT * FROM equipment_types WHERE id = ?', req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
}));
app.get('/api/equipment_models', wrap((req, res) => {
  const { equipment_type_id } = req.query;
  let sql = "SELECT em.*, et.name_zh as type_name FROM equipment_models em LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
  const params = [];
  if (equipment_type_id) { sql += ' AND em.equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY em.id';
  res.json(all(sql, params));
}));
app.get('/api/equipment_subsystems', wrap((req, res) => {
  const { equipment_type_id } = req.query;
  let sql = 'SELECT * FROM equipment_subsystems WHERE 1=1';
  const params = [];
  if (equipment_type_id) { sql += ' AND equipment_type_id = ?'; params.push(equipment_type_id); }
  sql += ' ORDER BY sequence';
  res.json(all(sql, params));
}));
app.get('/api/workstations', wrap((req, res) => res.json(all('SELECT * FROM workstations ORDER BY id'))));
app.get('/api/equipment', wrap((req, res) => res.json(all('SELECT * FROM equipment ORDER BY id'))));

// P2-#3 设备实时状态看板
app.get('/api/equipment/live_status', wrap((req, res) => {
  const equipment_total = get("SELECT COUNT(*) c FROM equipment") || { c: 0 };
  const equipment_idle = get("SELECT COUNT(*) c FROM equipment WHERE id NOT IN (SELECT workstation_id FROM work_orders WHERE status='in_progress' AND workstation_id IS NOT NULL)") || { c: 0 };
  const wo_in_progress = get("SELECT COUNT(*) c FROM work_orders WHERE status='in_progress'") || { c: 0 };
  const pn_in_progress = get("SELECT COUNT(*) c FROM process_nodes WHERE status='in_progress'") || { c: 0 };
  const by_subsystem = all("SELECT es.name_zh as subsystem, COUNT(DISTINCT pn.id) as in_progress_nodes FROM equipment_subsystems es LEFT JOIN process_nodes pn ON pn.equipment_instance_id IN (SELECT id FROM equipment_instances) WHERE pn.status='in_progress' GROUP BY es.id ORDER BY in_progress_nodes DESC");
  const recent_starts = all("SELECT wo.*, ei.instance_code, ei.instance_name FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status='in_progress' ORDER BY wo.actual_start DESC LIMIT 10");
  const utilization = equipment_total.c ? Math.round((equipment_total.c - equipment_idle.c) * 100 / equipment_total.c) : 0;
  res.json({ equipment_total: equipment_total.c, equipment_busy: equipment_total.c - equipment_idle.c, equipment_idle: equipment_idle.c, utilization, wo_in_progress: wo_in_progress.c, pn_in_progress: pn_in_progress.c, by_subsystem, recent_starts });
}));


}

module.exports = { register };
