const { ApiError } = require('../app/errors');
const { appendClosureNote, evaluateNcrClosure } = require('../app/domain/qualityNcr');
const { wrap } = require('../middleware/asyncHandler');
// services/qcService.js
// P0-#1: Quality Inspection + NCR/CAPA/Inspection Templates + Dashboard
// Author: 三狗子 | Date: 2026-06-26

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);

  // -------- Tables --------
  run(`CREATE TABLE IF NOT EXISTS ncr_reports (
    id INTEGER PRIMARY KEY,
    ncr_code TEXT UNIQUE,
    source_type TEXT,
    source_id INTEGER,
    equipment_instance_id INTEGER,
    part_name TEXT,
    defect_desc TEXT NOT NULL,
    defect_qty INTEGER,
    severity TEXT DEFAULT 'minor',
    disposition TEXT DEFAULT 'pending',
    disposition_by INTEGER,
    disposition_at TEXT,
    root_cause TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS capa_actions (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER,
    action_type TEXT NOT NULL,
    action_desc TEXT NOT NULL,
    assigned_to INTEGER,
    due_date TEXT,
    status TEXT DEFAULT 'open',
    completed_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    effectiveness TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS inspection_templates (
    id INTEGER PRIMARY KEY,
    template_name TEXT NOT NULL,
    equipment_type_id INTEGER,
    category TEXT,
    check_items TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS ncr_rechecks (
    id INTEGER PRIMARY KEY,
    ncr_id INTEGER NOT NULL,
    result TEXT NOT NULL,
    inspector_id INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ====== QC Inspections (existing) ======
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
    if (!equipment_instance_id || !inspection_type || !result) throw ApiError.validation('equipment_instance_id/inspection_type/result required');
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

  // ====== NCR (Non-Conformance Report) ======
  app.post('/api/qc/ncr', wrap((req, res) => {
    const { source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by } = req.body;
    if (!defect_desc) throw ApiError.validation('defect_desc required');

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = 'NCR-' + today + '-';
    const last = get("SELECT ncr_code FROM ncr_reports WHERE ncr_code LIKE ? ORDER BY id DESC LIMIT 1", [prefix + '%']);
    let seq = 1;
    if (last) {
      const lastSeq = parseInt(last.ncr_code.split('-').pop());
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    const ncr_code = prefix + String(seq).padStart(3, '0');

    const r = run(
      'INSERT INTO ncr_reports (ncr_code, source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ncr_code, source_type || null, source_id || null, equipment_instance_id || null, part_name || null, defect_desc, defect_qty || null, severity || 'minor', created_by || null]
    );
    res.json({ id: r.lastInsertRowid, ncr_code });
  }));

  app.get('/api/qc/ncr', wrap((req, res) => {
    const { equipment_instance_id, severity, status } = req.query;
    let sql = `SELECT n.*, ei.instance_code, u.full_name as created_by_name,
      CASE
        WHEN n.closed_at IS NOT NULL THEN 'closed'
        WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
        ELSE 'open'
      END AS status
      FROM ncr_reports n
      LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id
      LEFT JOIN users u ON n.created_by = u.id
      WHERE 1=1`;
    const params = [];
    if (equipment_instance_id) { sql += ' AND n.equipment_instance_id = ?'; params.push(equipment_instance_id); }
    if (severity) { sql += ' AND n.severity = ?'; params.push(severity); }
    if (status === 'open') { sql += " AND n.closed_at IS NULL AND (n.disposition IS NULL OR n.disposition = 'pending')"; }
    if (status === 'disposed') { sql += " AND n.closed_at IS NULL AND n.disposition IS NOT NULL AND n.disposition != 'pending'"; }
    if (status === 'closed') { sql += ' AND n.closed_at IS NOT NULL'; }
    sql += ' ORDER BY n.created_at DESC';
    res.json(all(sql, params));
  }));

  // NCR 统计 (必须在 /:id 之前注册)
  app.get('/api/qc/ncr/stats', wrap((req, res) => {
    const total = get("SELECT COUNT(*) c FROM ncr_reports") || {c:0};
    const byDisposition = all("SELECT disposition, COUNT(*) c FROM ncr_reports GROUP BY disposition");
    const bySeverity = all("SELECT severity, COUNT(*) c FROM ncr_reports GROUP BY severity");
    res.json({ total: total.c, by_disposition: byDisposition, by_severity: bySeverity });
  }));

  app.get('/api/qc/ncr/:id', wrap((req, res) => {
    const ncr = get('SELECT n.*, ei.instance_code, u.full_name as created_by_name FROM ncr_reports n LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id LEFT JOIN users u ON n.created_by = u.id WHERE n.id = ?', [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const capas = all('SELECT c.*, u.full_name as assignee_name FROM capa_actions c LEFT JOIN users u ON c.assigned_to = u.id WHERE c.ncr_id = ? ORDER BY c.created_at', [req.params.id]);
    res.json({ ...ncr, capa_actions: capas });
  }));

  app.put('/api/qc/ncr/:id/disposition', wrap((req, res) => {
    const { disposition, disposition_by, root_cause, reason } = req.body;
    if (!disposition || !['accept', 'rework', 'reject'].includes(disposition)) {
      throw ApiError.validation('disposition must be accept/rework/reject');
    }
    const ncr = get('SELECT id FROM ncr_reports WHERE id = ?', [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const closed_at = disposition === 'accept' ? new Date().toISOString() : null;
    run("UPDATE ncr_reports SET disposition = ?, disposition_by = ?, disposition_at = datetime('now'), root_cause = ?, closed_at = ? WHERE id = ?",
      [disposition, disposition_by || null, root_cause || reason || null, closed_at, req.params.id]);
    res.json({ ok: true });
  }));

  app.post('/api/qc/ncr/:id/capa', wrap((req, res) => {
    const ncr = get('SELECT id FROM ncr_reports WHERE id = ?', [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const { action_type, action_desc, assigned_to, due_date } = req.body;
    if (!action_type || !action_desc) throw ApiError.validation('action_type/action_desc required');
    const r = run('INSERT INTO capa_actions (ncr_id, action_type, action_desc, assigned_to, due_date) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, action_type, action_desc, assigned_to || null, due_date || null]);
    res.json({ id: r.lastInsertRowid });
  }));

  // ====== CAPA Actions ======
  app.get('/api/qc/capa', wrap((req, res) => {
    const { status, assigned_to } = req.query;
    let sql = `SELECT c.*, n.ncr_code, n.defect_desc, u.full_name as assignee_name,
      CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN ncr_reports n ON c.ncr_id = n.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE 1=1`;
    const params = [];
    if (status === 'overdue') { sql += " AND c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed'"; }
    else if (status) { sql += ' AND c.status = ?'; params.push(status); }
    if (assigned_to) { sql += ' AND c.assigned_to = ?'; params.push(assigned_to); }
    sql += ' ORDER BY c.created_at DESC';
    res.json(all(sql, params));
  }));

  app.put('/api/qc/capa/:id', wrap((req, res) => {
    const capa = get('SELECT id, status FROM capa_actions WHERE id = ?', [req.params.id]);
    if (!capa) throw ApiError.notFound('CAPA not found');
    const { status, completed_at, verified_by, effectiveness } = req.body;
    run("UPDATE capa_actions SET status = ?, completed_at = ?, verified_by = ?, verified_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE verified_at END, effectiveness = ? WHERE id = ?",
      [status || capa.status, completed_at || null, verified_by || null, verified_by, effectiveness || null, req.params.id]);
    res.json({ ok: true });
  }));

  // ====== Inspection Templates ======
  app.get('/api/qc/inspection-templates', wrap((req, res) => {
    const { category } = req.query;
    let sql = 'SELECT * FROM inspection_templates';
    const params = [];
    if (category) { sql += ' WHERE category = ?'; params.push(category); }
    sql += ' ORDER BY created_at DESC';
    res.json(all(sql, params));
  }));

  app.post('/api/qc/inspection-templates', wrap((req, res) => {
    const { template_name, equipment_type_id, category, check_items } = req.body;
    if (!template_name) throw ApiError.validation('template_name required');
    const r = run('INSERT INTO inspection_templates (template_name, equipment_type_id, category, check_items) VALUES (?, ?, ?, ?)',
      [template_name, equipment_type_id || null, category || null, check_items || null]);
    res.json({ id: r.lastInsertRowid });
  }));

  app.get('/api/qc/inspection-templates/:id', wrap((req, res) => {
    const tpl = get('SELECT * FROM inspection_templates WHERE id = ?', [req.params.id]);
    if (!tpl) throw ApiError.notFound('Template not found');
    let checkItems = [];
    try { checkItems = JSON.parse(tpl.check_items || '[]'); } catch (_e) {}
    res.json({ ...tpl, check_items: checkItems });
  }));

  // ====== 来料检验 (Incoming Inspection) ======
  app.post('/api/qc/incoming-inspection', wrap((req, res) => {
    const { purchase_order_id, material_id, lot_number, supplier, inspector_id, result, defect_desc, defect_qty, notes } = req.body;
    if (!material_id || !result) throw ApiError.validation("material_id and result required");
    const r = run("INSERT INTO qc_inspections (equipment_instance_id, work_order_id, inspection_type, result, inspector_id, notes) VALUES (?,?,?,?,?,?)",
      [null, null, "incoming", result, inspector_id || null, JSON.stringify({purchase_order_id, material_id, supplier, defect_desc, defect_qty, lot_number, notes})]);
    if (result === "fail") {
      const today = new Date().toISOString().slice(0,10).replace(/-/g,"");
      const prefix = "NCR-"+today+"-";
      const last = get("SELECT ncr_code FROM ncr_reports WHERE ncr_code LIKE ? ORDER BY id DESC LIMIT 1", [prefix+"%"]);
      let seq = 1;
      if (last) { const s = parseInt(last.ncr_code.split("-").pop()); if (!isNaN(s)) seq = s+1; }
      const ncr_code = prefix + String(seq).padStart(3,"0");
      run("INSERT INTO ncr_reports (ncr_code, source_type, source_id, part_name, defect_desc, defect_qty, severity, created_by) VALUES (?,?,?,?,?,?,?,?)",
        [ncr_code, "incoming", r.lastInsertRowid, "Material #"+material_id, defect_desc||"Incoming inspection failed", defect_qty||1, "major", inspector_id||null]);
    }
    res.json({ id: r.lastInsertRowid, result });
  }));

  app.get('/api/qc/incoming-inspection', wrap((req, res) => {
    res.json(all("SELECT q.*, u.full_name AS inspector_name FROM qc_inspections q LEFT JOIN users u ON q.inspector_id=u.id WHERE q.inspection_type='incoming' ORDER BY q.inspection_date DESC LIMIT 100"));
  }));

  // ====== NCR Closure Loop: disposition -> CAPA -> recheck -> close ======
  app.get('/api/qc/ncr/:id/capa', wrap((req, res) => {
    const ncr = get('SELECT id FROM ncr_reports WHERE id = ?', [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const rows = all(`
      SELECT c.*, u.full_name as assignee_name,
        CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.ncr_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  }));

  app.put('/api/qc/capa/:id/complete', wrap((req, res) => {
    const capa = get('SELECT id FROM capa_actions WHERE id = ?', [req.params.id]);
    if (!capa) throw ApiError.notFound('CAPA not found');
    const { effectiveness, verified_by } = req.body || {};
    run(`
      UPDATE capa_actions
      SET status = 'closed',
          completed_at = COALESCE(completed_at, datetime('now')),
          verified_by = COALESCE(?, verified_by),
          verified_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE verified_at END,
          effectiveness = COALESCE(?, effectiveness)
      WHERE id = ?
    `, [verified_by || null, verified_by || null, effectiveness || null, req.params.id]);
    res.json({ ok: true });
  }));

  app.post('/api/qc/ncr/:id/recheck', wrap((req, res) => {
    const ncr = get('SELECT id FROM ncr_reports WHERE id = ?', [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const { result, inspector_id, notes } = req.body || {};
    if (!['pass', 'fail'].includes(result)) throw ApiError.validation('result must be pass/fail');
    const r = run(
      'INSERT INTO ncr_rechecks (ncr_id, result, inspector_id, notes) VALUES (?, ?, ?, ?)',
      [req.params.id, result, inspector_id || null, notes || null]
    );
    res.json({ id: r.lastInsertRowid, ok: true });
  }));

  app.get('/api/qc/ncr/:id/closure', wrap((req, res) => {
    const ncr = get(`
      SELECT n.*, ei.instance_code, u.full_name as created_by_name,
        CASE
          WHEN n.closed_at IS NOT NULL THEN 'closed'
          WHEN n.disposition IS NOT NULL AND n.disposition != 'pending' THEN 'disposed'
          ELSE 'open'
        END AS status
      FROM ncr_reports n
      LEFT JOIN equipment_instances ei ON n.equipment_instance_id = ei.id
      LEFT JOIN users u ON n.created_by = u.id
      WHERE n.id = ?
    `, [req.params.id]);
    if (!ncr) throw ApiError.notFound('NCR not found');
    const capas = all(`
      SELECT c.*, u.full_name as assignee_name,
        CASE WHEN c.due_date IS NOT NULL AND date(c.due_date) < date('now') AND c.status != 'closed' THEN 1 ELSE 0 END AS overdue
      FROM capa_actions c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.ncr_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);
    const rechecks = all(`
      SELECT r.*, u.full_name AS inspector_name
      FROM ncr_rechecks r
      LEFT JOIN users u ON r.inspector_id = u.id
      WHERE r.ncr_id = ?
      ORDER BY r.created_at DESC
    `, [req.params.id]);
    const closure = evaluateNcrClosure(ncr, capas, rechecks);
    res.json({
      ncr,
      capa_actions: capas,
      rechecks,
      checklist: closure.checklist,
      blockers: closure.blockers,
      can_close: closure.canClose,
    });
  }));

  app.post('/api/qc/ncr/:id/close', wrap((req, res) => {
    const closure = (() => {
      const ncr = get('SELECT * FROM ncr_reports WHERE id = ?', [req.params.id]);
      if (!ncr) throw ApiError.notFound('NCR not found');
      const capas = all('SELECT status FROM capa_actions WHERE ncr_id = ?', [req.params.id]);
      const rechecks = all('SELECT result FROM ncr_rechecks WHERE ncr_id = ?', [req.params.id]);
      const closure = evaluateNcrClosure(ncr, capas, rechecks);
      return { ncr, canClose: closure.canClose, blockers: closure.blockers };
    })();
    if (!closure.canClose) throw ApiError.validation(`NCR closure checklist is not complete: ${closure.blockers.join('、')}`);
    const { note } = req.body || {};
    const rootCause = appendClosureNote(closure.ncr.root_cause, note);
    run("UPDATE ncr_reports SET closed_at = COALESCE(closed_at, datetime('now')), root_cause = ? WHERE id = ?", [rootCause || null, req.params.id]);
    res.json({ ok: true });
  }));

  // ====== Quality Dashboard ======
  app.get('/api/qc/dashboard', wrap((req, res) => {
    const ncr_open = get("SELECT COUNT(*) c FROM ncr_reports WHERE closed_at IS NULL")?.c || 0;
    const ncr_resolved_30d = get("SELECT COUNT(*) c FROM ncr_reports WHERE closed_at >= datetime('now', '-30 days')")?.c || 0;
    const capa_open = get("SELECT COUNT(*) c FROM capa_actions WHERE status != 'closed'")?.c || 0;
    const capa_overdue = get("SELECT COUNT(*) c FROM capa_actions WHERE due_date < datetime('now') AND status != 'closed'")?.c || 0;
    const pass_row = get("SELECT COUNT(*) c FROM qc_inspections WHERE inspection_date >= datetime('now', '-30 days')");
    const pass_c = pass_row?.c || 0;
    const pass_c_ok = get("SELECT COUNT(*) c FROM qc_inspections WHERE inspection_date >= datetime('now', '-30 days') AND result='pass'")?.c || 0;
    const pass_rate_30d = pass_c ? Math.round(pass_c_ok * 100 / pass_c) : 0;
    const defect_top5 = all("SELECT defect_desc, COUNT(*) as count FROM ncr_reports GROUP BY defect_desc ORDER BY count DESC LIMIT 5");
    res.json({
      ncr_open, ncr_resolved_30d, capa_open, capa_overdue, pass_rate_30d,
      defect_top5: defect_top5.map(d => ({ defect_type: d.defect_desc, count: d.count }))
    });
  }));
}

module.exports = { register };
