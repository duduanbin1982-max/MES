// services/qcService.js
// P0-#1 拆 server.js: 质量检验 (QC Inspections + 合格率统计)
// Author: 三狗子 | Date: 2026-06-23

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  };

  app.get('/api/qc_inspections', wrap((req, res) => {
    const { equipment_instance_id, work_order_id, inspection_type, result } = req.query;
    let sql = 'SELECT q.*, u.full_name as inspector_name FROM qc_inspections q LEFT JOIN users u ON q.inspector_id = u.id WHERE 1=1';
    const params = [];
    if (equipment_instance_id) { sql += ' AND q.equipment_instance_id = ?'; params.push(equipment_instance_id); }
    if (work_order_id) { sql += ' AND q.work_order_id = ?'; params.push(work_order_id); }
    if (inspection_type) { sql += ' AND q.inspection_type = ?'; params.push(inspection_type); }
    if (result) { sql += ' AND q.result = ?'; params.push(result); }
    sql += ' ORDER BY q.inspection_date DESC';
    res.json(all(sql, params));
  }));

  app.post('/api/qc_inspections', wrap((req, res) => {
    const { equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes } = req.body;
    if (!equipment_instance_id || !inspection_type || !result) return res.status(400).json({ error: 'equipment_instance_id/inspection_type/result 必填' });
    const r = run('INSERT INTO qc_inspections (equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [equipment_instance_id, work_order_id || null, inspection_type, result, inspector_id || null, notes || null]);
    res.json({ id: r.lastInsertRowid });
  }));

  app.get('/api/qc/stats', wrap((req, res) => {
    const total = get("SELECT COUNT(*) c FROM qc_inspections") || { c: 0 };
    const pass = get("SELECT COUNT(*) c FROM qc_inspections WHERE result='pass'") || { c: 0 };
    const fail = get("SELECT COUNT(*) c FROM qc_inspections WHERE result='fail'") || { c: 0 };
    const pass_rate = total.c ? Math.round(pass.c * 100 / total.c) : 0;
    const by_type = all("SELECT inspection_type, COUNT(*) as total, SUM(CASE WHEN result='pass' THEN 1 ELSE 0 END) as pass_cnt, SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) as fail_cnt FROM qc_inspections GROUP BY inspection_type ORDER BY total DESC");
    const recent_fail = all("SELECT q.*, ei.instance_code, u.full_name as inspector_name FROM qc_inspections q LEFT JOIN equipment_instances ei ON q.equipment_instance_id = ei.id LEFT JOIN users u ON q.inspector_id = u.id WHERE q.result='fail' ORDER BY q.inspection_date DESC LIMIT 10");
    res.json({ total: total.c, pass: pass.c, fail: fail.c, pass_rate, by_type, recent_fail });
  }));
}

module.exports = { register };
