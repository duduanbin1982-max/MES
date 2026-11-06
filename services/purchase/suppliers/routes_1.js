"use strict";
// services/purchase/suppliers.js 的路由组 1（AST 版拆分）

module.exports = function registerRoutes1(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const audit = require('../../../app/audit');
const { BOOTSTRAP_TEMPLATES, REQUIRED_SUPPLIER_CATEGORIES, SUPPLIER_CATEGORIES, all, buildSetupSummary, categoryLabel, decorate, nextSupplierCode, run, safeJson } = ctx;

app.get('/api/suppliers/categories', wrap((_req, res) => {
    res.json(SUPPLIER_CATEGORIES);
  }))

app.get('/api/suppliers', wrap((req, res) => {
    const { is_active, supplier_category, category } = req.query
    const categoryFilter = supplier_category || category
    let sql = 'SELECT * FROM suppliers WHERE 1=1'
    const params = []
    if (is_active !== undefined) { sql += ' AND is_active = ?'; params.push(parseInt(is_active, 10)) }
    if (categoryFilter) {
      sql += " AND (supplier_category = ? OR business_categories LIKE ?)"
      params.push(categoryFilter, `%"${categoryFilter}"%`)
    }
    sql += ' ORDER BY supplier_category, supplier_code'
    res.json(all(sql, params).map(decorate))
  }))

app.get('/api/suppliers/setup-summary', wrap((_req, res) => {
    const rows = all('SELECT * FROM suppliers ORDER BY supplier_code').map(decorate)
    res.json(buildSetupSummary(rows))
  }))

app.post('/api/suppliers/bootstrap-defaults', wrap((req, res) => {
    const requested = safeJson(req.body?.categories, REQUIRED_SUPPLIER_CATEGORIES)
    const rows = all('SELECT * FROM suppliers')
    const covered = new Set()
    const existingCodes = new Set(rows.map((row) => row.supplier_code).filter(Boolean))
    for (const row of rows) {
      for (const category of safeJson(row.business_categories, row.supplier_category ? [row.supplier_category] : [])) {
        covered.add(category)
      }
    }
    const created = []
    for (const template of BOOTSTRAP_TEMPLATES) {
      if (!requested.includes(template.category)) continue
      if (covered.has(template.category)) continue
      const supplier_code = nextSupplierCode(existingCodes, template.code_prefix)
      existingCodes.add(supplier_code)
      covered.add(template.category)
      const categories = [template.category]
      const result = run(`INSERT INTO suppliers (
        supplier_code, supplier_name, contact_person, payment_terms, rating, notes,
        supplier_category, business_categories, is_key_supplier, is_outsource_supplier, is_standard_supplier, category_notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
        supplier_code,
        template.supplier_name,
        template.contact_person,
        '月结30天',
        template.rating,
        `${categoryLabel(template.category)}首日模板`,
        template.category,
        JSON.stringify(categories),
        template.category === 'key_component' ? 1 : 0,
        template.category === 'outsourcing' ? 1 : 0,
        template.category === 'standard_part' ? 1 : 0,
        template.category_notes,
      ])
      created.push({ id: result.lastInsertRowid, supplier_code, supplier_name: template.supplier_name, supplier_category: template.category })
    }
    const summary = buildSetupSummary(all('SELECT * FROM suppliers ORDER BY supplier_code').map(decorate))
    audit.record(db, req, {
      action: 'supplier.bootstrap',
      resource_type: 'supplier',
      after: { created_codes: created.map((row) => row.supplier_code) },
      diff_summary: '按模板创建供应商 ' + created.length + ' 个',
    })
    res.json({ created, summary })
  }))
};
