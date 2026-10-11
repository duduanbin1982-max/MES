// services/tbmAdvanced/faultKB.js
// 从 tbmAdvanced.js 拆分 (brooks-audit R2)
'use strict';
const { ApiError } = require('../../app/errors');

const { wrap } = require('../../middleware/asyncHandler');

const logger = require("../../app/logger").createLogger("tbmAdvanced");

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p||[]));
  const get = (sql, p) => db.prepare(sql).get(...(p||[]));
  const run = (sql, p) => db.prepare(sql).run(...(p||[]));
// ============================================================
  app.get('/api/fault-knowledge', wrap((req, res) => {
    const { equipment_type_id, difficulty, keyword } = req.query;
    let sql = "SELECT fk.*, et.name_zh AS type_name FROM fault_knowledge fk LEFT JOIN equipment_types et ON fk.equipment_type_id=et.id WHERE 1=1";
    const p = [];
    if (equipment_type_id) { sql += ' AND fk.equipment_type_id=?'; p.push(equipment_type_id); }
    if (difficulty) { sql += ' AND fk.difficulty=?'; p.push(difficulty); }
    if (keyword) { sql += " AND (fk.fault_name LIKE ? OR fk.symptom LIKE ? OR fk.root_cause LIKE ?)"; const kw='%'+keyword+'%'; p.push(kw,kw,kw); }
    sql += ' ORDER BY fk.fault_code LIMIT 200';
    res.json(all(sql, p));
  }));
  app.get('/api/fault-knowledge/:id', wrap((req, res) => {
    const r = get("SELECT fk.*, et.name_zh AS type_name FROM fault_knowledge fk LEFT JOIN equipment_types et ON fk.equipment_type_id=et.id WHERE fk.id=?", [req.params.id]);
    if (!r) throw ApiError.notFound('not found')
    r.spare_parts_parsed = JSON.parse(r.spare_parts||'[]');
    res.json(r);
  }));
  app.post('/api/fault-knowledge', wrap((req, res) => {
    const { equipment_type_id, fault_code, fault_name, symptom, root_cause, solution, spare_parts, difficulty, frequency, tags } = req.body;
    if (!fault_code||!fault_name) throw ApiError.validation('fault_code/fault_name required')
    const r = run("INSERT INTO fault_knowledge (equipment_type_id,fault_code,fault_name,symptom,root_cause,solution,spare_parts,difficulty,frequency,tags) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [equipment_type_id||null,fault_code,fault_name,symptom||null,root_cause||null,solution||null,JSON.stringify(spare_parts||[]),difficulty||'medium',frequency||'occasional',tags||null]);
    res.json({id:r.lastInsertRowid});
  }));
  app.put('/api/fault-knowledge/:id', wrap((req, res) => {
    const fields = ['equipment_type_id','fault_code','fault_name','symptom','root_cause','solution','spare_parts','difficulty','frequency','tags'];
    const set=[]; const vals=[];
    for (const f of fields) {
      if (req.body[f]!==undefined) {
        set.push(f+'=?');
        vals.push(f==='spare_parts' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (!set.length) throw ApiError.validation('no fields')
    set.push("updated_at=datetime('now')"); vals.push(req.params.id);
    run('UPDATE fault_knowledge SET '+set.join(',')+' WHERE id=?', vals);
    res.json({success:true});
  }));
  app.delete('/api/fault-knowledge/:id', wrap((req, res) => {
    run('DELETE FROM fault_knowledge WHERE id=?', [req.params.id]);
    res.json({success:true});
  }));

  logger.info('[tbmAdvanced] Critical parts + Purchase tracking + Project dashboard + Acceptance + Fault KB registered');
}

module.exports = { registerRoutes };
