// services/tbmAdvanced/projectDashboard.js
// 从 tbmAdvanced.js 拆分 (brooks-audit R2)
'use strict';

const { wrap } = require('../../middleware/asyncHandler');
const { ApiError } = require('../../app/errors');

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
// ============================================================
  app.get('/api/contract-milestones', wrap((req, res) => {
    const { equipment_instance_id } = req.query;
    let sql = "SELECT cm.*, ei.instance_code, ei.instance_name FROM contract_milestones cm JOIN equipment_instances ei ON cm.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND cm.equipment_instance_id=?'; p.push(equipment_instance_id); }
    sql += ' ORDER BY cm.sequence';
    const milestones = all(sql, p);
    // attach payments
    for (const m of milestones) {
      m.payments = all("SELECT * FROM project_payments WHERE milestone_id=? ORDER BY received_date DESC", [m.id]);
    }
    res.json(milestones);
  }));
  app.post('/api/contract-milestones', wrap((req, res) => {
    const { equipment_instance_id, milestone_name, planned_date, payment_pct, payment_amount, sequence } = req.body;
    if (!equipment_instance_id||!milestone_name) throw ApiError.validation('required fields missing');
    const r = run("INSERT INTO contract_milestones (equipment_instance_id,milestone_name,planned_date,payment_pct,payment_amount,sequence) VALUES (?,?,?,?,?,?)",
      [equipment_instance_id,milestone_name,planned_date||null,payment_pct||0,payment_amount||0,sequence||1]);
    res.json({id:r.lastInsertRowid});
  }));
  app.put('/api/contract-milestones/:id', wrap((req, res) => {
    const fields = ['milestone_name','planned_date','actual_date','payment_pct','payment_amount','status','sequence'];
    const set=[]; const vals=[];
    for (const f of fields) if (req.body[f]!==undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
    if (!set.length) throw ApiError.validation('no fields to update');
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE contract_milestones SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  // 收款记录
  app.get('/api/project-payments', wrap((req, res) => {
    const { equipment_instance_id } = req.query;
    let sql = "SELECT pp.*, cm.milestone_name, ei.instance_code FROM project_payments pp LEFT JOIN contract_milestones cm ON pp.milestone_id=cm.id JOIN equipment_instances ei ON pp.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND pp.equipment_instance_id=?'; p.push(equipment_instance_id); }
    sql += ' ORDER BY pp.received_date DESC LIMIT 100';
    res.json(all(sql, p));
  }));
  app.post('/api/project-payments', wrap((req, res) => {
    const { equipment_instance_id, milestone_id, amount, received_date, payment_method, voucher_no, notes } = req.body;
    if (!equipment_instance_id||!amount) throw ApiError.validation('required fields missing');
    const r = run("INSERT INTO project_payments (equipment_instance_id,milestone_id,amount,received_date,payment_method,voucher_no,notes) VALUES (?,?,?,?,?,?,?)",
      [equipment_instance_id,milestone_id||null,amount,received_date||null,payment_method||null,voucher_no||null,notes||null]);
    // update milestone actual_date if status was pending
    if (milestone_id) run("UPDATE contract_milestones SET status='completed',actual_date=COALESCE(actual_date,?) WHERE id=? AND status='pending'", [received_date||null, milestone_id]);
    res.json({id:r.lastInsertRowid});
  }));
  // 项目汇总
  app.get('/api/project-summary/:id', wrap((req, res) => {
    const inst = get("SELECT * FROM equipment_instances WHERE id=?", [req.params.id]);
    if (!inst) throw ApiError.notFound();
    const totalPayment = get("SELECT SUM(amount) total FROM project_payments WHERE equipment_instance_id=?", [req.params.id])?.total||0;
    const contractAmount = inst.contract_amount||0;
    const milestones = all("SELECT * FROM contract_milestones WHERE equipment_instance_id=? ORDER BY sequence", [req.params.id]);
    const completed = milestones.filter(m=>m.status==='completed').length;
    res.json({
      equipment: {id:inst.id,code:inst.instance_code,name:inst.instance_name,contract_no:inst.contract_no,contract_amount:contractAmount},
      total_payment: totalPayment,
      payment_rate: contractAmount>0 ? Math.round(totalPayment/contractAmount*100) : 0,
      milestones_total: milestones.length,
      milestones_completed: completed,
      milestones,
    });
  }));
}

module.exports = { registerRoutes };
