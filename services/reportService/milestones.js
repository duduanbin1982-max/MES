// 里程碑: 列表 + 自动生成 S1-S10 阶段
function register(app, db) {
  const { all, wrap } = require('./_helpers').makeHelpers(db)

  app.get('/api/equipment_instances/:id/milestones', wrap((req, res) =>
    res.json(all('SELECT * FROM instance_milestones WHERE equipment_instance_id = ? ORDER BY sequence', req.params.id))
  ))

  app.post('/api/equipment_instances/:id/milestones/auto-generate', wrap((req, res) => {
    const phases = [['S1','设计冻结',1],['S2','采购',2],['S3','自制件生产',3],['S4','部件预装',4],['S5','总装',5],['S6','厂内调试',6],['S7','拆解/包装/发运',7],['S8','现场组装',8],['S9','试掘进/验收',9],['S10','质保期',10]]
    const ins = db.prepare('INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, sequence, planned_start, status) VALUES (?, ?, ?, ?, ?, ?)')
    for (const [code, name, seq] of phases) ins.run(req.params.id, code, name, seq, '2026-07-01', 'pending')
    res.json({ count: phases.length })
  }))
}

module.exports = { register }