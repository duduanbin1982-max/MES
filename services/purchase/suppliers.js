// services/purchase/suppliers.js
// 供应商 CRUD
// Author: 三狗子 | Date: 2026-06-25

const { makeHelpers } = require('./_helpers')

function register(app, db) {
  const { all, get, run, wrap } = makeHelpers(db)

  app.get('/api/suppliers', wrap((req, res) => {
    const { is_active } = req.query
    let sql = 'SELECT * FROM suppliers'
    const params = []
    if (is_active !== undefined) { sql += ' WHERE is_active = ?'; params.push(parseInt(is_active, 10)) }
    sql += ' ORDER BY supplier_code'
    res.json(all(sql, params))
  }))

  app.get('/api/suppliers/:id', wrap((req, res) => {
    const r = get('SELECT * FROM suppliers WHERE id = ?', req.params.id)
    if (!r) return res.status(404).json({ error: 'supplier not found' })
    // 顺手带这个供应商的 PO 统计
    const stats = get("SELECT COUNT(*) AS po_count, COALESCE(SUM(total_amount), 0) AS total_amount FROM purchase_orders WHERE supplier_id = ?", req.params.id)
    res.json(Object.assign({}, r, stats))
  }))

  app.post('/api/suppliers', wrap((req, res) => {
    const { supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes } = req.body
    if (!supplier_code || !supplier_name) return res.status(400).json({ error: 'supplier_code / supplier_name 必填' })
    const dup = get('SELECT id FROM suppliers WHERE supplier_code = ?', supplier_code)
    if (dup) return res.status(400).json({ error: 'supplier_code 已存在: ' + supplier_code })
    const r = run("INSERT INTO suppliers (supplier_code, supplier_name, contact_person, phone, email, address, payment_terms, rating, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [supplier_code, supplier_name, contact_person || null, phone || null, email || null, address || null, payment_terms || null, rating || 'B', notes || null])
    res.json({ id: r.lastInsertRowid })
  }))

  app.patch('/api/suppliers/:id', wrap((req, res) => {
    const allowed = ['supplier_name', 'contact_person', 'phone', 'email', 'address', 'payment_terms', 'rating', 'is_active', 'notes']
    const sets = [], params = []
    for (const k of allowed) if (req.body[k] !== undefined) { sets.push(k + ' = ?'); params.push(req.body[k]) }
    if (!sets.length) return res.status(400).json({ error: '无可更新字段' })
    sets.push("updated_at = datetime('now')")
    params.push(req.params.id)
    const r = run('UPDATE suppliers SET ' + sets.join(', ') + ' WHERE id = ?', params)
    res.json({ changes: r.changes })
  }))
}

module.exports = { register }