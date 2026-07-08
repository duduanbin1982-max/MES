// services/tbmAdvanced/acceptance.js
// 从 tbmAdvanced.js 拆分 (brooks-audit R2)
'use strict';
const { ApiError } = require('../../app/errors');

const { wrap } = require('../../middleware/asyncHandler');

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
// ============================================================
  app.get('/api/acceptance-checklists', wrap((req, res) => {
    const { equipment_instance_id, status } = req.query;
    let sql = "SELECT acl.*, ei.instance_code FROM acceptance_checklists acl JOIN equipment_instances ei ON acl.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND acl.equipment_instance_id=?'; p.push(equipment_instance_id); }
    if (status) { sql += ' AND acl.status=?'; p.push(status); }
    sql += ' ORDER BY acl.created_at DESC';
    res.json(all(sql, p));
  }));
  app.get('/api/acceptance-checklists/:id', wrap((req, res) => {
    const r = get("SELECT acl.*, ei.instance_code, ei.instance_name FROM acceptance_checklists acl JOIN equipment_instances ei ON acl.equipment_instance_id=ei.id WHERE acl.id=?", [req.params.id]);
    if (!r) throw ApiError.notFound('not found')
    r.items_parsed = JSON.parse(r.items||'[]');
    res.json(r);
  }));
  app.post('/api/acceptance-checklists', wrap((req, res) => {
    const { equipment_instance_id, checklist_name, items, inspector, customer_rep } = req.body;
    if (!equipment_instance_id||!checklist_name) throw ApiError.validation('required')
    const r = run("INSERT INTO acceptance_checklists (equipment_instance_id,checklist_name,items,inspector,customer_rep) VALUES (?,?,?,?,?)",
      [equipment_instance_id,checklist_name,JSON.stringify(items||[]),inspector||null,customer_rep||null]);
    res.json({id:r.lastInsertRowid});
  }));
  app.put('/api/acceptance-checklists/:id', wrap((req, res) => {
    const fields = ['checklist_name','items','status','inspector','customer_rep','result','issues','sign_date','signature_path'];
    const set=[]; const vals=[];
    for (const f of fields) {
      if (req.body[f]!==undefined) {
        set.push(f+'=?');
        vals.push(f==='items' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!set.length) throw ApiError.validation('no fields')
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE acceptance_checklists SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  // 调试工时记录
  app.post('/api/acceptance-checklists/:id/debug-hours', wrap((req, res) => {
    const { hours, worker, date, notes } = req.body;
    const acl = get("SELECT items FROM acceptance_checklists WHERE id=?", [req.params.id]);
    if (!acl) throw ApiError.notFound('not found')
    let items = JSON.parse(acl.items||'[]');
    if (!Array.isArray(items.find(i=>i.type==='debug_hours')?.records)) {
      if (!items.find(i=>i.type==='debug_hours')) items.push({type:'debug_hours',label:'调试工时记录',records:[]});
      else items.find(i=>i.type==='debug_hours').records = [];
    }
    items.find(i=>i.type==='debug_hours').records.push({hours,worker,date,notes,logged_at:new Date().toISOString()});
    run("UPDATE acceptance_checklists SET items=? WHERE id=?", [JSON.stringify(items), req.params.id]);
    res.json({success:true,total_hours:items.find(i=>i.type==='debug_hours').records.reduce((s,r)=>s+(r.hours||0),0)});
  }));
}

module.exports = { registerRoutes };
