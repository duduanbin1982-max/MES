// services/tbmAdvanced/criticalParts.js
// 从 tbmAdvanced.js 拆分 (brooks-audit R2)
'use strict';
const { ApiError } = require('../../app/errors');

const { wrap } = require('../../middleware/asyncHandler');

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
// ============================================================
  app.get('/api/critical-parts', wrap((req, res) => {
    const { equipment_instance_id, risk_level } = req.query;
    let sql = "SELECT cp.*, ei.instance_code, ei.instance_name FROM critical_parts cp LEFT JOIN equipment_instances ei ON cp.equipment_instance_id=ei.id WHERE 1=1";
    const p = [];
    if (equipment_instance_id) { sql += ' AND cp.equipment_instance_id=?'; p.push(equipment_instance_id); }
    if (risk_level) { sql += ' AND cp.risk_level=?'; p.push(risk_level); }
    sql += ' ORDER BY cp.risk_level DESC, cp.part_code';
    res.json(all(sql, p));
  }));
  app.get('/api/critical-parts/:id', wrap((req, res) => {
    const r = get("SELECT cp.*, ei.instance_code, ei.instance_name FROM critical_parts cp LEFT JOIN equipment_instances ei ON cp.equipment_instance_id=ei.id WHERE cp.id=?", [req.params.id]);
    if (!r) throw ApiError.notFound('not found')
    r.certificates = all("SELECT * FROM critical_part_certificates WHERE part_id=? ORDER BY issue_date DESC", [req.params.id]);
    r.logs = all("SELECT * FROM supervision_logs WHERE part_id=? ORDER BY log_date DESC LIMIT 50", [req.params.id]);
    res.json(r);
  }));
  app.post('/api/critical-parts', wrap((req, res) => {
    const { equipment_instance_id, part_code, part_name, part_type, drawing_no, spec, supplier, manufacturing_standard, inspection_points, risk_level, notes } = req.body;
    if (!part_code||!part_name) throw ApiError.validation('part_code/part_name required')
    const r = run("INSERT INTO critical_parts (equipment_instance_id,part_code,part_name,part_type,drawing_no,spec,supplier,manufacturing_standard,inspection_points,risk_level,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [equipment_instance_id||null,part_code,part_name,part_type||'mechanical',drawing_no||null,spec||null,supplier||null,manufacturing_standard||null,inspection_points||'[]',risk_level||'medium',notes||null]);
    res.json({id:r.lastInsertRowid});
  }));
  app.put('/api/critical-parts/:id', wrap((req, res) => {
    const fields = ['equipment_instance_id','part_code','part_name','part_type','drawing_no','spec','supplier','manufacturing_standard','inspection_points','risk_level','status','notes'];
    const set=[]; const vals=[];
    for (const f of fields) if (req.body[f]!==undefined) { set.push(f+'=?'); vals.push(req.body[f]); }
    if (!set.length) throw ApiError.validation('no fields')
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE critical_parts SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  // 资质证书 CRUD
  app.post('/api/critical-parts/:id/certificates', wrap((req, res) => {
    const { cert_type, cert_no, issued_by, issue_date, expiry_date, file_path } = req.body;
    if (!cert_type) throw ApiError.validation('cert_type required')
    const r = run("INSERT INTO critical_part_certificates (part_id,cert_type,cert_no,issued_by,issue_date,expiry_date,file_path) VALUES (?,?,?,?,?,?,?)",
      [req.params.id,cert_type,cert_no||null,issued_by||null,issue_date||null,expiry_date||null,file_path||null]);
    res.json({id:r.lastInsertRowid});
  }));
  app.delete('/api/critical-parts/:id/certificates/:certId', wrap((req, res) => {
    run('DELETE FROM critical_part_certificates WHERE id=? AND part_id=?', [req.params.certId, req.params.id]);
    res.json({success:true});
  }));
  // 监造日志 CRUD
  app.get('/api/supervision-logs', wrap((req, res) => {
    const { part_id, equipment_instance_id } = req.query;
    let sql = "SELECT sl.*, cp.part_code, cp.part_name FROM supervision_logs sl LEFT JOIN critical_parts cp ON sl.part_id=cp.id WHERE 1=1";
    const p = [];
    if (part_id) { sql += ' AND sl.part_id=?'; p.push(part_id); }
    if (equipment_instance_id) { sql += ' AND sl.equipment_instance_id=?'; p.push(equipment_instance_id); }
    sql += ' ORDER BY sl.log_date DESC LIMIT 200';
    res.json(all(sql, p));
  }));
  app.post('/api/supervision-logs', wrap((req, res) => {
    const { equipment_instance_id, part_id, log_date, inspector, location, content, photos, issues, status } = req.body;
    if (!log_date) throw ApiError.validation('log_date required')
    const r = run("INSERT INTO supervision_logs (equipment_instance_id,part_id,log_date,inspector,location,content,photos,issues,status) VALUES (?,?,?,?,?,?,?,?,?)",
      [equipment_instance_id||null,part_id||null,log_date,inspector||null,location||null,content||null,photos||'[]',issues||null,status||'normal']);
    res.json({id:r.lastInsertRowid});
  }));
}

module.exports = { registerRoutes };
