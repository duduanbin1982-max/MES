// ECO (Engineering Change Order): 列表 + 新建 + 更新
function register(app, db) {
  const { all, run, wrap } = require('./_helpers').makeHelpers(db)

  app.get('/api/equipment_instances/:id/eco', wrap((req, res) =>
    res.json(all('SELECT * FROM instance_eco WHERE equipment_instance_id = ? ORDER BY id DESC', req.params.id))
  ))

  app.post('/api/equipment_instances/:id/eco', wrap((req, res) => {
    const { eco_no, title, reason, affected_scope, effective_date, created_by } = req.body
    if (!eco_no || !title) return res.status(400).json({ error: 'eco_no/title 必填' })
    const r = run("INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.params.id, eco_no, title, reason || null, affected_scope || null, effective_date || null, created_by || null])
    res.json({ id: r.lastInsertRowid })
  }))

  app.put('/api/instance_eco/:id', wrap((req, res) => {
    const { status, effective_date, closed_date, reason, affected_scope } = req.body
    const sets = []; const params = []
    if (status !== undefined) { sets.push('status = ?'); params.push(status) }
    if (effective_date !== undefined) { sets.push('effective_date = ?'); params.push(effective_date) }
    if (closed_date !== undefined) { sets.push('closed_date = ?'); params.push(closed_date) }
    if (reason !== undefined) { sets.push('reason = ?'); params.push(reason) }
    if (affected_scope !== undefined) { sets.push('affected_scope = ?'); params.push(affected_scope) }
    if (!sets.length) return res.status(400).json({ error: '无可更新字段' })
    sets.push("updated_at = datetime('now')")
    params.push(req.params.id)
    const r = run(`UPDATE instance_eco SET ${sets.join(', ')} WHERE id = ?`, params)
    res.json({ changes: r.changes })
  }))
}

module.exports = { register }