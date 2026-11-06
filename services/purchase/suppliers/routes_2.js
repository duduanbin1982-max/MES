"use strict";
// services/purchase/suppliers.js 的路由组 2（AST 版拆分）

module.exports = function registerRoutes2(app, db, ctx) {
const { ApiError } = require('../../../app/errors');
const { wrap } = require('../../../middleware/asyncHandler');
const audit = require('../../../app/audit');
const { validateCreatePayload, validateUpdatePayload } = require('./validation');
const { SUPPLIER_CATEGORIES, decorate, get, run } = ctx;
const CATEGORY_VALUES = SUPPLIER_CATEGORIES.map((item) => item.value);
function tableExists(name) {
  return !!get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)
}

app.get('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT * FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const stats = get("SELECT COUNT(*) AS po_count, COALESCE(SUM(total_amount), 0) AS total_amount FROM purchase_orders WHERE supplier_id = ?", req.params.id)
    res.json(Object.assign({}, decorate(r), stats))
  }))

app.post('/api/suppliers', wrap((req, res) => {
    const body = req.body || {}
    const payload = validateCreatePayload(body, CATEGORY_VALUES)
    const dup = get('SELECT id FROM suppliers WHERE UPPER(TRIM(supplier_code)) = UPPER(?)', payload.code)
    if (dup) throw ApiError.validation('supplier_code 已存在: ' + payload.code)
    const r = run(`INSERT INTO suppliers (
        supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes,
        supplier_category, business_categories, is_key_supplier, is_outsource_supplier, is_standard_supplier, category_notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.code, payload.name, body.contact_person || null, body.phone || null, body.email || null, body.address || null,
        body.payment_terms || null, payload.rating, body.notes || null, payload.supplierCategory, JSON.stringify(payload.categories),
        payload.categories.includes('key_component') ? 1 : 0,
        payload.categories.includes('outsourcing') ? 1 : 0,
        payload.categories.includes('standard_part') ? 1 : 0,
        body.category_notes || null,
        payload.isActive,
      ])
    audit.record(db, req, {
      action: 'supplier.create',
      resource_type: 'supplier',
      resource_id: r.lastInsertRowid,
      after: {
        supplier_code: payload.code,
        supplier_name: payload.name,
        rating: payload.rating,
        supplier_category: payload.supplierCategory,
        is_active: payload.isActive,
      },
      diff_summary: '创建供应商 ' + payload.code + '（' + payload.name + '）',
    })
    res.json({ id: r.lastInsertRowid })
  }))

app.patch('/api/suppliers/:id', wrap((req, res) => {
    const existing = get('SELECT * FROM suppliers WHERE id = ?', req.params.id)
    if (!existing) throw ApiError.notFound('supplier not found')
    const body = validateUpdatePayload(req.body || {}, CATEGORY_VALUES)
    for (const key of ['contact_person', 'phone', 'email', 'address', 'payment_terms', 'notes', 'category_notes']) {
      if (req.body[key] !== undefined) body[key] = req.body[key]
    }
    const allowed = [
      'supplier_name', 'contact_person', 'phone', 'email', 'address', 'payment_terms', 'rating', 'is_active', 'notes',
      'supplier_category', 'business_categories', 'is_key_supplier', 'is_outsource_supplier', 'is_standard_supplier', 'category_notes'
    ]
    const sets = [], params = []
    for (const k of allowed) if (body[k] !== undefined) { sets.push(k + ' = ?'); params.push(body[k]) }
    if (!sets.length) throw ApiError.validation('无可更新字段')
    sets.push("updated_at = datetime('now')")
    params.push(req.params.id)
    const r = run('UPDATE suppliers SET ' + sets.join(', ') + ' WHERE id = ?', params)
    audit.record(db, req, {
      action: 'supplier.update',
      resource_type: 'supplier',
      resource_id: existing.id,
      before: {
        supplier_name: existing.supplier_name,
        rating: existing.rating,
        is_active: existing.is_active,
        supplier_category: existing.supplier_category,
      },
      after: Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])),
      diff_summary: '更新供应商 ' + existing.supplier_code,
    })
    res.json({ changes: r.changes })
  }))

app.delete('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT id, supplier_code, supplier_name, is_active FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const references = {
      purchase_orders: get('SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id = ?', req.params.id).c,
      outsourcing_orders: tableExists('outsourcing_orders') ? get('SELECT COUNT(*) AS c FROM outsourcing_orders WHERE supplier_id = ?', req.params.id).c : 0,
      incoming_inspections: tableExists('incoming_inspections') ? get('SELECT COUNT(*) AS c FROM incoming_inspections WHERE supplier_id = ?', req.params.id).c : 0,
    }
    const blocking = Object.entries(references).filter(([, count]) => Number(count) > 0)
    if (blocking.length > 0) {
      throw ApiError.conflict('该供应商仍被业务单据引用，无法删除', {
        supplier_id: Number(req.params.id),
        references,
        hint: '请先转移或作废关联单据，或改为停用（is_active=0）',
      })
    }
    const tx = db.transaction(() => {
      if (tableExists('supplier_score_snapshots')) run('DELETE FROM supplier_score_snapshots WHERE supplier_id = ?', req.params.id)
      run('DELETE FROM suppliers WHERE id = ?', req.params.id)
    })
    tx()
    audit.record(db, req, {
      action: 'supplier.delete',
      resource_type: 'supplier',
      resource_id: r.id,
      before: { supplier_code: r.supplier_code, supplier_name: r.supplier_name, is_active: r.is_active },
      diff_summary: '删除供应商 ' + r.supplier_code,
    })
    res.json({ ok: true })
  }))
};
