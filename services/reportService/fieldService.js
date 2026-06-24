// 现场服务: 列表 + 新建
function register(app, db) {
  const { all, run, wrap } = require('./_helpers').makeHelpers(db)

  app.get('/api/field_service', wrap((req, res) =>
    res.json(all("SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id ORDER BY fs.reported_date DESC"))
  ))

  app.post('/api/field_service', wrap((req, res) => {
    const { equipment_instance_id, service_type, title, description, priority } = req.body
    if (!equipment_instance_id || !title) return res.status(400).json({ error: '必填' })
    const r = run("INSERT INTO field_service (equipment_instance_id, service_type, title, description, priority) VALUES (?, ?, ?, ?, ?)",
      [equipment_instance_id, service_type, title, description || null, priority || 'normal'])
    res.json({ id: r.lastInsertRowid })
  }))
}

module.exports = { register }