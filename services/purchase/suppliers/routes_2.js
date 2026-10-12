"use strict";
// services/purchase/suppliers.js 的路由组 2（AST 版拆分）

module.exports = function registerRoutes2(app, db, ctx) {
const { ApiError } = require('../../../app/errors');
const { wrap } = require('../../../middleware/asyncHandler');
const { SUPPLIER_CATEGORIES, decorate, get, run, safeJson } = ctx;

app.get('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT * FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const stats = get("SELECT COUNT(*) AS po_count, COALESCE(SUM(total_amount), 0) AS total_amount FROM purchase_orders WHERE supplier_id = ?", req.params.id)
    res.json(Object.assign({}, decorate(r), stats))
  }))

app.post('/api/suppliers', wrap((req, res) => {
    const {
      supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes,
      supplier_category = 'general', business_categories, category_notes, is_active = 1,
    } = req.body
    if (!supplier_code || !supplier_name) throw ApiError.validation('supplier_code / supplier_name 必填')
    if (!SUPPLIER_CATEGORIES.some((item) => item.value === supplier_category)) throw ApiError.validation('供应商分类不合法')
    const categories = safeJson(business_categories, [supplier_category])
    const dup = get('SELECT id FROM suppliers WHERE supplier_code = ?', supplier_code)
    if (dup) throw ApiError.validation('supplier_code 已存在: ' + supplier_code)
    const r = run(`INSERT INTO suppliers (
        supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes,
        supplier_category, business_categories, is_key_supplier, is_outsource_supplier, is_standard_supplier, category_notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_code, supplier_name, contact_person || null, phone || null, email || null, address || null,
        payment_terms || null, rating || 'B', notes || null, supplier_category, JSON.stringify(categories),
        categories.includes('key_component') ? 1 : 0,
        categories.includes('outsourcing') ? 1 : 0,
        categories.includes('standard_part') ? 1 : 0,
        category_notes || null,
        is_active ? 1 : 0,
      ])
    res.json({ id: r.lastInsertRowid })
  }))

app.patch('/api/suppliers/:id', wrap((req, res) => {
    const existing = get('SELECT id FROM suppliers WHERE id = ?', req.params.id)
    if (!existing) throw ApiError.notFound('supplier not found')
    const body = { ...req.body }
    if (body.supplier_category && !SUPPLIER_CATEGORIES.some((item) => item.value === body.supplier_category)) throw ApiError.validation('供应商分类不合法')
    if (body.business_categories !== undefined) {
      const categories = safeJson(body.business_categories, body.supplier_category ? [body.supplier_category] : []);
      body.business_categories = JSON.stringify(categories);
      body.is_key_supplier = categories.includes('key_component') ? 1 : 0;
      body.is_outsource_supplier = categories.includes('outsourcing') ? 1 : 0;
      body.is_standard_supplier = categories.includes('standard_part') ? 1 : 0;
      if (!body.supplier_category && categories.length) body.supplier_category = categories[0];
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
    res.json({ changes: r.changes })
  }))

app.delete('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT id, supplier_name FROM suppliers WHERE id = ?', req.params.id)
    if (!r) throw ApiError.notFound('supplier not found')
    const poCount = get('SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id = ?', req.params.id).c
    if (poCount > 0) throw ApiError.validation('该供应商有 ' + poCount + ' 个关联采购订单, 无法删除')
    run('DELETE FROM suppliers WHERE id = ?', req.params.id)
    res.json({ ok: true })
  }))
};
