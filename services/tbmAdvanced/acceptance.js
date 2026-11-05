// services/tbmAdvanced/acceptance.js
// 2026-11-05（DLV-6 验收表统一）：验收清单端点改为读写 acceptance_records（与交付链路同一张表）。
//   · checklist_name / items 以 `CHECKLIST:` 前缀写入 notes（JSON），兼容原前端字段
//   · 旧表 acceptance_checklists 由 scripts/migrate-acceptance-unify.js 迁移后置 archived，只读保留审计
'use strict';
const { ApiError } = require('../../app/errors');
const { wrap } = require('../../middleware/asyncHandler');

const CHECKLIST_PREFIX = 'CHECKLIST:';

function encodeChecklist(name, items) {
  return CHECKLIST_PREFIX + JSON.stringify({ name: name || '', items: Array.isArray(items) ? items : [] });
}

function decodeChecklist(notes) {
  if (typeof notes === 'string' && notes.startsWith(CHECKLIST_PREFIX)) {
    try {
      const parsed = JSON.parse(notes.slice(CHECKLIST_PREFIX.length));
      return { name: parsed.name || '', items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch (_error) {
      return { name: notes, items: [] };
    }
  }
  return { name: notes || '', items: [] };
}

function mapRow(row) {
  const decoded = decodeChecklist(row.notes);
  return {
    id: row.id,
    acceptance_no: row.acceptance_no,
    equipment_instance_id: row.equipment_instance_id,
    instance_code: row.instance_code,
    instance_name: row.instance_name,
    checklist_name: decoded.name || (row.acceptance_type ? String(row.acceptance_type).toUpperCase() + ' 验收单' : '验收单'),
    items: decoded.items,
    items_parsed: decoded.items,
    status: row.result === 'pending' ? 'pending' : 'completed',
    result: row.result,
    inspector: row.signer_name,
    customer_rep: row.customer_name,
    sign_date: row.signed_at,
    issues: row.condition_note,
    signature_path: null,
    delivery_order_id: row.delivery_order_id,
    milestone_id: row.milestone_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function registerRoutes(app, db) {
  const all = (sql, p) => db.prepare(sql).all(...(p || []));
  const get = (sql, p) => db.prepare(sql).get(...(p || []));
  const run = (sql, p) => db.prepare(sql).run(...(p || []));

  app.get('/api/acceptance-checklists', wrap((req, res) => {
    const { equipment_instance_id, status } = req.query;
    let sql = `SELECT ar.*, ei.instance_code, ei.instance_name
               FROM acceptance_records ar
               LEFT JOIN equipment_instances ei ON ei.id = ar.equipment_instance_id
               WHERE 1=1`;
    const params = [];
    if (equipment_instance_id) { sql += ' AND ar.equipment_instance_id=?'; params.push(equipment_instance_id); }
    if (status) {
      if (status === 'pending') { sql += " AND ar.result='pending'"; }
      else if (status === 'completed') { sql += " AND ar.result<>'pending'"; }
      else { sql += ' AND ar.result=?'; params.push(status); }
    }
    sql += ' ORDER BY ar.created_at DESC, ar.id DESC';
    res.json(all(sql, params).map(mapRow));
  }));

  app.get('/api/acceptance-checklists/:id', wrap((req, res) => {
    const row = get(`SELECT ar.*, ei.instance_code, ei.instance_name
                     FROM acceptance_records ar
                     LEFT JOIN equipment_instances ei ON ei.id = ar.equipment_instance_id
                     WHERE ar.id=?`, [req.params.id]);
    if (!row) throw ApiError.notFound('not found');
    res.json(mapRow(row));
  }));

  app.post('/api/acceptance-checklists', wrap((req, res) => {
    const { equipment_instance_id, checklist_name, items, inspector, customer_rep } = req.body || {};
    if (!equipment_instance_id || !checklist_name) throw ApiError.validation('equipment_instance_id / checklist_name 必填');
    const instance = get('SELECT id FROM equipment_instances WHERE id=?', [equipment_instance_id]);
    if (!instance) throw ApiError.notFound('equipment_instance not found');
    const acceptanceNo = `AC-CL-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
    const result = run(
      `INSERT INTO acceptance_records (acceptance_no, equipment_instance_id, acceptance_type, result, customer_name, signer_name, notes, created_by)
       VALUES (?, ?, 'fat', 'pending', ?, ?, ?, ?)`,
      [acceptanceNo, instance.id, customer_rep || null, inspector || null, encodeChecklist(checklist_name, items), req.user?.uid || null]
    );
    res.json({ id: result.lastInsertRowid, acceptance_no: acceptanceNo });
  }));

  app.put('/api/acceptance-checklists/:id', wrap((req, res) => {
    const row = get('SELECT * FROM acceptance_records WHERE id=?', [req.params.id]);
    if (!row) throw ApiError.notFound('not found');
    const body = req.body || {};
    const decoded = decodeChecklist(row.notes);
    const name = body.checklist_name !== undefined ? body.checklist_name : decoded.name;
    const items = body.items !== undefined ? body.items : decoded.items;
    const sets = ['notes=?', "updated_at=datetime('now')"];
    const values = [encodeChecklist(name, items)];
    if (body.inspector !== undefined) { sets.push('signer_name=?'); values.push(body.inspector); }
    if (body.customer_rep !== undefined) { sets.push('customer_name=?'); values.push(body.customer_rep); }
    if (body.result !== undefined) { sets.push('result=?'); values.push(body.result); }
    if (body.issues !== undefined) { sets.push('condition_note=?'); values.push(body.issues); }
    if (body.sign_date !== undefined) { sets.push('signed_at=?'); values.push(body.sign_date); }
    values.push(req.params.id);
    run(`UPDATE acceptance_records SET ${sets.join(', ')} WHERE id=?`, values);
    res.json({ success: true });
  }));

  app.post('/api/acceptance-checklists/:id/debug-hours', wrap((req, res) => {
    const { hours, worker, date, notes } = req.body || {};
    const row = get('SELECT * FROM acceptance_records WHERE id=?', [req.params.id]);
    if (!row) throw ApiError.notFound('not found');
    const decoded = decodeChecklist(row.notes);
    let bucket = decoded.items.find((item) => item && item.type === 'debug_hours');
    if (!bucket) { bucket = { type: 'debug_hours', label: '调试工时记录', records: [] }; decoded.items.push(bucket); }
    if (!Array.isArray(bucket.records)) bucket.records = [];
    bucket.records.push({ hours: Number(hours) || 0, worker, date, notes, logged_at: new Date().toISOString() });
    run("UPDATE acceptance_records SET notes=?, updated_at=datetime('now') WHERE id=?", [encodeChecklist(decoded.name, decoded.items), row.id]);
    const totalHours = bucket.records.reduce((sum, record) => sum + (Number(record.hours) || 0), 0);
    res.json({ success: true, total_hours: Math.round(totalHours * 100) / 100 });
  }));
}

module.exports = { registerRoutes, encodeChecklist, decodeChecklist, mapRow, CHECKLIST_PREFIX };
