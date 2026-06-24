// services/workOrderService.js
// P0-#1 拆 server.js: 工单/工序操作/焊缝记录
// Author: 三狗子 | Date: 2026-06-23

function register(app, db, auth) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

app.get('/api/work_orders', wrap((req, res) => {
  const { equipment_instance_id, subsystem_id, status } = req.query;
  let sql = "SELECT wo.*, ei.instance_code, ei.instance_name, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE 1=1";
  const params = [];
  if (equipment_instance_id) { sql += ' AND wo.equipment_instance_id = ?'; params.push(equipment_instance_id); }
  if (subsystem_id) { sql += ' AND wo.subsystem_id = ?'; params.push(subsystem_id); }
  if (status) { sql += ' AND wo.status = ?'; params.push(status); }
  sql += ' ORDER BY wo.created_at DESC';
  res.json(all(sql, params));
}));

app.get('/api/work_orders/:id', wrap((req, res) => {
  const wo = get("SELECT wo.*, ei.instance_code, es.name_zh as subsystem_name FROM work_orders wo LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id LEFT JOIN equipment_subsystems es ON wo.subsystem_id = es.id WHERE wo.id = ?", req.params.id);
  if (!wo) return res.status(404).json({ error: 'not found' });
  wo.operations = all('SELECT * FROM work_order_operations WHERE work_order_id = ? ORDER BY timestamp', req.params.id);
  res.json(wo);
}));

app.post('/api/work_orders', auth.onlyForemanOrAdmin, wrap((req, res) => {
  const { wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start } = req.body;
  if (!wo_code || !equipment_instance_id || !title) return res.status(400).json({ error: 'wo_code/equipment_instance_id/title 必填' });
  const r = run("INSERT INTO work_orders (wo_code, equipment_instance_id, milestone_id, subsystem_id, title, workstation_id, estimated_hours, planned_start, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    [wo_code, equipment_instance_id, milestone_id || null, subsystem_id || null, title, workstation_id || null, estimated_hours || null, planned_start || null]);
  res.json({ id: r.lastInsertRowid });
}));

app.post('/api/work_orders/:id/operations', wrap((req, res) => {
  const { operator_id, action, hours_worked, notes } = req.body;
  const r = run("INSERT INTO work_order_operations (work_order_id, operator_id, action, hours_worked, notes) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, operator_id || null, action, hours_worked || null, notes || null]);
  if (action === 'start') run("UPDATE work_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, datetime('now')) WHERE id = ?", req.params.id);
  else if (action === 'complete') run("UPDATE work_orders SET status = 'completed', actual_end = datetime('now') WHERE id = ?", req.params.id);
  else if (action === 'pause') run("UPDATE work_orders SET status = 'paused' WHERE id = ?", req.params.id);
  res.json({ id: r.lastInsertRowid });
}));

app.post('/api/work_orders/:id/welds', auth.onlyWelder, wrap((req, res) => {
  const { weld_no, welder_id, material_lot_id, weld_length_mm } = req.body;
  if (!weld_no || !welder_id) return res.status(400).json({ error: 'weld_no/welder_id 必填' });
  const r = run("INSERT INTO weld_records (work_order_id, weld_no, welder_id, material_lot_id, weld_length_mm) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, weld_no, welder_id, material_lot_id || null, weld_length_mm || null]);
  res.json({ id: r.lastInsertRowid });
}));

}

module.exports = { register };
