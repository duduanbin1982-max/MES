const { wrap } = require('../../middleware/asyncHandler');
const { ensureFieldServiceSchema } = require('../fieldServiceSchema');
// services/reportService/fieldService.js
// 现场服务: 工单 + 备件库 + 维保计划
// Author: Codex | Date: 2026-06-26

function runMigration(db) {
  ensureFieldServiceSchema(db);
}


function register(app, db) {
  runMigration(db);
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
  

  app.get('/api/field_service', wrap((req, res) =>
    res.json(all("SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id ORDER BY fs.reported_date DESC"))
  ));
  app.get('/api/field_service/:id', wrap((req, res) => {
    const r = get("SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id WHERE fs.id=?", [req.params.id]);
    if (!r) return res.status(404).json({error:'not found'});
    res.json(r);
  }));
  app.post('/api/field_service', wrap((req, res) => {
    const { equipment_instance_id, service_type, title, description, priority } = req.body;
    if (!equipment_instance_id || !title) return res.status(400).json({ error: 'equipment_instance_id/title required' });
    const r = run("INSERT INTO field_service (equipment_instance_id, service_type, title, description, priority) VALUES (?,?,?,?,?)",
      [equipment_instance_id, service_type, title, description||null, priority||'normal']);
    res.json({ id: r.lastInsertRowid });
  }));
  app.put('/api/field_service/:id', wrap((req, res) => {
    const fields = ['status','resolution_notes','service_type','title','description','priority','assigned_to'];
    const set = []; const vals = [];
    for (const f of fields) if (req.body[f] !== undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
    if (!set.length) return res.status(400).json({error:'no fields'});
    if (req.body.status === 'resolved') { set.push("resolved_date=datetime('now')"); }
    vals.push(req.params.id);
    run('UPDATE field_service SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));

  app.get('/api/spare_parts', wrap((req, res) => {
    const { equipment_instance_id, part_type, low_stock } = req.query;
    let sql = "SELECT sp.*, ei.instance_code, ei.instance_name FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND sp.equipment_instance_id=?'; p.push(equipment_instance_id); }
    if (part_type) { sql += ' AND sp.part_type=?'; p.push(part_type); }
    if (low_stock === '1') { sql += ' AND sp.quantity <= sp.min_stock'; }
    sql += ' ORDER BY sp.part_code';
    res.json(all(sql, p));
  }));
  app.get('/api/spare_parts/:id', wrap((req, res) => {
    const r = get("SELECT sp.*, ei.instance_code, ei.instance_name FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id=ei.id WHERE sp.id=?", [req.params.id]);
    if (!r) return res.status(404).json({error:'not found'});
    res.json(r);
  }));
  app.post('/api/spare_parts', wrap((req, res) => {
    const { equipment_instance_id, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes } = req.body;
    if (!part_code || !part_name) return res.status(400).json({error:'part_code/part_name required'});
    const r = run("INSERT INTO spare_parts (equipment_instance_id, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [equipment_instance_id||null, part_code, part_name, part_type||'mechanical', quantity||0, min_stock||5, unit||'pcs', location||null, supplier||null, unit_price||0, notes||null]);
    res.json({ id: r.lastInsertRowid });
  }));
  app.put('/api/spare_parts/:id', wrap((req, res) => {
    const fields = ['equipment_instance_id','part_code','part_name','part_type','quantity','min_stock','unit','location','supplier','unit_price','notes'];
    const set = []; const vals = [];
    for (const f of fields) if (req.body[f] !== undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
    if (!set.length) return res.status(400).json({error:'no fields'});
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE spare_parts SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  app.delete('/api/spare_parts/:id', wrap((req, res) => {
    run('DELETE FROM spare_parts WHERE id=?', [req.params.id]);
    res.json({success:true});
  }));
  app.get('/api/spare_parts/alerts', wrap((req, res) => {
    res.json(all("SELECT sp.*, ei.instance_code FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id=ei.id WHERE sp.quantity <= sp.min_stock ORDER BY (sp.min_stock-sp.quantity) DESC"));
  }));

  app.get('/api/maintenance_plans', wrap((req, res) => {
    const { equipment_instance_id, status, overdue } = req.query;
    let sql = "SELECT mp.*, ei.instance_code, ei.instance_name, u.full_name AS assignee_name FROM maintenance_plans mp LEFT JOIN equipment_instances ei ON mp.equipment_instance_id=ei.id LEFT JOIN users u ON mp.assigned_to=u.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND mp.equipment_instance_id=?'; p.push(equipment_instance_id); }
    if (status) { sql += ' AND mp.status=?'; p.push(status); }
    if (overdue === '1') { sql += " AND mp.next_due_date < date('now') AND mp.status != 'completed'"; }
    sql += ' ORDER BY mp.next_due_date ASC';
    res.json(all(sql, p));
  }));
  app.get('/api/maintenance_plans/:id', wrap((req, res) => {
    const r = get("SELECT mp.*, ei.instance_code, ei.instance_name, u.full_name AS assignee_name FROM maintenance_plans mp LEFT JOIN equipment_instances ei ON mp.equipment_instance_id=ei.id LEFT JOIN users u ON mp.assigned_to=u.id WHERE mp.id=?", [req.params.id]);
    if (!r) return res.status(404).json({error:'not found'});
    r.spare_parts = all("SELECT sp.*, msp.quantity AS plan_qty FROM maintenance_spare_parts msp JOIN spare_parts sp ON msp.spare_part_id=sp.id WHERE msp.plan_id=?", [req.params.id]);
    res.json(r);
  }));
  app.post('/api/maintenance_plans', wrap((req, res) => {
    const { equipment_instance_id, plan_code, plan_name, maintenance_type, frequency_days, next_due_date, assigned_to, spare_parts, notes } = req.body;
    if (!plan_code || !plan_name) return res.status(400).json({error:'plan_code/plan_name required'});
    const tx = db.transaction(() => {
      const r = run("INSERT INTO maintenance_plans (equipment_instance_id, plan_code, plan_name, maintenance_type, frequency_days, next_due_date, assigned_to, notes) VALUES (?,?,?,?,?,?,?,?)",
        [equipment_instance_id||null, plan_code, plan_name, maintenance_type||'routine', frequency_days||90, next_due_date||null, assigned_to||null, notes||null]);
      if (Array.isArray(spare_parts) && spare_parts.length) {
        const ins = db.prepare("INSERT OR IGNORE INTO maintenance_spare_parts (plan_id, spare_part_id, quantity) VALUES (?,?,?)");
        spare_parts.forEach(sp => ins.run(r.lastInsertRowid, sp.spare_part_id, sp.quantity||1));
      }
      return r;
    });
    const r = tx();
    res.json({ id: r.lastInsertRowid });
  }));
  app.put('/api/maintenance_plans/:id', wrap((req, res) => {
    const tx = db.transaction(() => {
      const fields = ['equipment_instance_id','plan_code','plan_name','maintenance_type','frequency_days','next_due_date','last_done_date','status','assigned_to','notes'];
      const set = []; const vals = [];
      for (const f of fields) if (req.body[f] !== undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
      if (set.length) { set.push("updated_at=datetime('now')"); vals.push(req.params.id); run('UPDATE maintenance_plans SET '+set.join(',')+' WHERE id=?', vals); }
      if (req.body.spare_parts !== undefined) {
        run('DELETE FROM maintenance_spare_parts WHERE plan_id=?', [req.params.id]);
        if (Array.isArray(req.body.spare_parts) && req.body.spare_parts.length) {
          const ins = db.prepare("INSERT OR IGNORE INTO maintenance_spare_parts (plan_id, spare_part_id, quantity) VALUES (?,?,?)");
          req.body.spare_parts.forEach(sp => ins.run(req.params.id, sp.spare_part_id, sp.quantity||1));
        }
      }
    });
    tx();
    res.json({success:true});
  }));
  app.delete('/api/maintenance_plans/:id', wrap((req, res) => {
    run('DELETE FROM maintenance_spare_parts WHERE plan_id=?', [req.params.id]);
    run('DELETE FROM maintenance_plans WHERE id=?', [req.params.id]);
    res.json({success:true});
  }));
  app.post('/api/maintenance_plans/:id/complete', wrap((req, res) => {
    const plan = get("SELECT * FROM maintenance_plans WHERE id=?", [req.params.id]);
    if (!plan) return res.status(404).json({error:'not found'});
    const nextDate = plan.frequency_days ? "date('now','+"+plan.frequency_days+" days')" : "date('now','+90 days')";
    run("UPDATE maintenance_plans SET status='completed', last_done_date=date('now'), next_due_date="+nextDate+", updated_at=datetime('now') WHERE id=?", [req.params.id]);
    res.json({success:true, next_due_date: get("SELECT next_due_date FROM maintenance_plans WHERE id=?",[req.params.id])?.next_due_date});
  }));
  app.get('/api/maintenance_plans/stats', wrap((req, res) => {
    const total = get("SELECT COUNT(*) c FROM maintenance_plans")?.c||0;
    const pending = get("SELECT COUNT(*) c FROM maintenance_plans WHERE status='pending'")?.c||0;
    const inProgress = get("SELECT COUNT(*) c FROM maintenance_plans WHERE status='in_progress'")?.c||0;
    const completed = get("SELECT COUNT(*) c FROM maintenance_plans WHERE status='completed'")?.c||0;
    const overdue = get("SELECT COUNT(*) c FROM maintenance_plans WHERE next_due_date < date('now') AND status != 'completed'")?.c||0;
    res.json({ total, pending, in_progress: inProgress, completed, overdue });
  }));

  console.log("[fieldService] registered");
}

module.exports = { register };
