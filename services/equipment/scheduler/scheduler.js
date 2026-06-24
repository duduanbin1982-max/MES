// POST /api/equipment_instances/:id/schedule (GET 也允许, 方便调试)
// 拓扑排序 + 关键路径 + 工位冲突解决
// query: ?dryRun=1 预览不写; ?start=YYYY-MM-DD 覆盖项目开始日
const { makeHelpers, addHours, maxDate } = require('./_helpers')
const { topologicalSort } = require('./topo')

function register(app, db) {
  const { all, get, wrap } = makeHelpers(db)

  function scheduleInstance(req, res) {
    const instanceId = parseInt(req.params.id, 10)
    const dryRun = req.query.dryRun === '1'
    const startOverride = req.query.start

    // 1) 项目开始日
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', instanceId)
    if (!inst) return res.status(404).json({ error: 'instance not found' })
    const projectStart = startOverride || inst.planned_start || inst.start_date || new Date().toISOString().slice(0, 10)

    // 2) 拿所有 process_nodes + 依赖
    const nodes = all('SELECT * FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sequence, id', instanceId)
    if (nodes.length === 0) return res.json({ count: 0, message: 'no nodes' })
    const deps = all('SELECT * FROM process_dependencies WHERE equipment_instance_id = ?', instanceId)

    // 3) 拓扑排序 + 环检测
    const { topo, cyclic } = topologicalSort(nodes, deps)
    if (cyclic.length) {
      return res.status(400).json({ error: 'cycle detected in dependencies', cyclic_node_ids: cyclic })
    }

    // 4) 按拓扑序排程
    const nodeSchedule = {} // id -> { planned_start, planned_end, hours, ws_id }
    const wsLastEnd = {}    // workstation_id -> ISO
    const errors = []
    const byId = {}
    for (const n of nodes) byId[n.id] = n

    for (const id of topo) {
      const node = byId[id]
      const hours = node.estimated_hours || 0

      // 4a) 前驱约束
      let earliest = projectStart
      const predDeps = (deps || []).filter(d => d.successor_id === id)
      for (const d of predDeps) {
        const p = nodeSchedule[d.predecessor_id]
        if (!p) { errors.push('Node ' + id + ': predecessor ' + d.predecessor_id + ' not scheduled'); continue }
        const depType = d.dep_type || 'FS'
        let constraint
        if (depType === 'FS') constraint = p.planned_end
        else if (depType === 'SS') constraint = p.planned_start
        else if (depType === 'FF') constraint = addHours(p.planned_end, -(hours))
        else constraint = p.planned_end
        const withLag = addHours(constraint, d.lag_hours || 0)
        earliest = maxDate(earliest, withLag)
      }

      // 4b) 工位冲突
      const wsId = node.required_workstation_id
      if (wsId && wsLastEnd[wsId] && wsLastEnd[wsId] > earliest) {
        earliest = wsLastEnd[wsId]
      }

      // 4c) 写排程
      const start = earliest
      const end = addHours(start, hours)
      nodeSchedule[id] = { planned_start: start, planned_end: end, hours, ws_id: wsId || null }
      if (wsId) wsLastEnd[wsId] = end
    }

    // 5) 写回 DB (除非 dryRun)
    let writtenCount = 0
    if (!dryRun && errors.length === 0) {
      const update = db.prepare('UPDATE process_nodes SET planned_start = ?, planned_end = ? WHERE id = ?')
      const tx = db.transaction((ids) => {
        for (const id of ids) {
          const s = nodeSchedule[id]
          update.run(s.planned_start, s.planned_end, id)
          writtenCount++
        }
      })
      tx(Object.keys(nodeSchedule))
    }

    // 6) 排序结果 (按时间) 方便 Gantt 渲染
    const scheduleArr = Object.entries(nodeSchedule).map(([id, s]) => Object.assign({ id: parseInt(id) }, s, { operation_name: byId[id] && byId[id].operation_name }))
    scheduleArr.sort((a, b) => a.planned_start.localeCompare(b.planned_start))

    res.json({
      instance_id: instanceId,
      instance_code: inst.instance_code,
      project_start: projectStart,
      node_count: nodes.length,
      dep_count: deps.length,
      written_count: writtenCount,
      dry_run: !!dryRun,
      errors,
      sample: scheduleArr.slice(0, 5),
      full: dryRun ? scheduleArr : undefined
    })
  }

  app.post('/api/equipment_instances/:id/schedule', wrap(scheduleInstance))
  app.get('/api/equipment_instances/:id/schedule', wrap(scheduleInstance))
}

module.exports = { register }