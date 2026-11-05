// services/equipment/scheduler/scheduler.js
// POST /api/equipment_instances/:id/schedule (GET 也允许, 方便调试)
// 拓扑排序 + 关键路径 + 工位冲突解决
// query: ?dryRun=1 预览不写; ?start=YYYY-MM-DD 覆盖项目开始日
//
// 2026-11-05（审计 F-03 整改）：
//   1) 默认跳过已完成/已取消节点（不重写历史计划）；
//   2) dryRun 返回"将被变更"的明细（旧 → 新），前端先预览再确认；
//   3) 真正写库时记录批次（process_reschedule_batches，批次号 SC-…），可用既有撤销接口回滚。
const { makeHelpers, addHours, maxDate } = require('./_helpers')
const { topologicalSort } = require('./topo')

const PROTECTED_STATUSES = new Set(['completed', 'cancelled'])

function register(app, db) {
  const { all, get, wrap } = makeHelpers(db)

  function nextBatchNo() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const row = db.prepare('SELECT COUNT(*) AS c FROM process_reschedule_batches WHERE batch_no LIKE ?').get(`SC-${day}-%`)
    return `SC-${day}-${String(Number(row.c) + 1).padStart(3, '0')}`
  }

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
    if (nodes.length === 0) return res.json({ node_count: 0, written_count: 0, message: 'no nodes' })
    const deps = all('SELECT * FROM process_dependencies WHERE equipment_instance_id = ?', instanceId)

    const byId = {}
    for (const n of nodes) byId[n.id] = n
    const protectedNodes = nodes.filter((n) => PROTECTED_STATUSES.has(String(n.status)))
    const schedulableNodes = nodes.filter((n) => !PROTECTED_STATUSES.has(String(n.status)))
    const schedulableIds = new Set(schedulableNodes.map((n) => Number(n.id)))

    // 3) 拓扑排序 + 环检测（只在可排节点之间判断）
    const schedulableDeps = deps.filter((d) => schedulableIds.has(Number(d.predecessor_id)) && schedulableIds.has(Number(d.successor_id)))
    const { topo, cyclic } = topologicalSort(schedulableNodes, schedulableDeps)
    if (cyclic.length) {
      return res.status(400).json({ error: 'cycle detected in dependencies', cyclic_node_ids: cyclic })
    }

    // 固定节点（已完成/已取消）：用现有计划或实际时间作为约束锚点
    const fixed = {}
    for (const n of protectedNodes) {
      const start = n.planned_start || n.actual_start || null
      const end = n.planned_end || n.actual_end || start
      fixed[Number(n.id)] = { planned_start: start, planned_end: end, hours: Number(n.estimated_hours) || 0, status: n.status }
    }

    // 4) 按拓扑序排程
    const nodeSchedule = {} // id -> { planned_start, planned_end, hours, ws_id, previous_* }
    const wsLastEnd = {}    // workstation_id -> end 字符串
    const errors = []

    for (const id of topo.map(Number)) {
      const node = byId[id]
      const hours = Number(node.estimated_hours) || 0

      // 4a) 前驱约束（支持 FS/SS/FF/SF + lag；前驱可能是已完成节点）
      let earliest = projectStart
      const predDeps = (deps || []).filter((d) => Number(d.successor_id) === id)
      for (const d of predDeps) {
        const predecessorId = Number(d.predecessor_id)
        const p = nodeSchedule[predecessorId] || fixed[predecessorId]
        if (!p || !p.planned_end) {
          errors.push('Node ' + id + ': predecessor ' + predecessorId + ' not scheduled')
          continue
        }
        const depType = d.dep_type || 'FS'
        let constraint
        if (depType === 'FS') constraint = p.planned_end
        else if (depType === 'SS') constraint = p.planned_start
        else if (depType === 'FF') constraint = addHours(p.planned_end, -hours)
        else constraint = p.planned_end
        const withLag = addHours(constraint, Number(d.lag_hours) || 0)
        earliest = maxDate(earliest, withLag)
      }

      // 4b) 工位冲突（同工位串行）
      const wsId = node.required_workstation_id
      if (wsId && wsLastEnd[wsId] && wsLastEnd[wsId] > earliest) {
        earliest = wsLastEnd[wsId]
      }

      // 4c) 写排程（不落库，先算）
      const start = earliest
      const end = addHours(start, hours)
      nodeSchedule[id] = {
        planned_start: start,
        planned_end: end,
        hours,
        ws_id: wsId || null,
        previous_planned_start: node.planned_start || null,
        previous_planned_end: node.planned_end || null,
      }
      if (wsId) wsLastEnd[wsId] = end
    }

    // 5) 变更对比（供 dryRun 预览 / 真实写入时只写有变化的）
    const changes = Object.entries(nodeSchedule)
      .map(([id, s]) => ({
        id: Number(id),
        operation_name: (byId[id] && byId[id].operation_name) || null,
        status: (byId[id] && byId[id].status) || 'pending',
        previous_planned_start: s.previous_planned_start,
        previous_planned_end: s.previous_planned_end,
        planned_start: s.planned_start,
        planned_end: s.planned_end,
        changed: String(s.previous_planned_start || '') !== String(s.planned_start || '') || String(s.previous_planned_end || '') !== String(s.planned_end || ''),
      }))
    const changedRows = changes.filter((item) => item.changed)
    changes.sort((a, b) => String(a.planned_start).localeCompare(String(b.planned_start)))

    const protectedSummary = protectedNodes.map((n) => ({ id: n.id, operation_name: n.operation_name, status: n.status }))

    // 6) 写回 DB（除非 dryRun / 有错误）
    let writtenCount = 0
    let batchNo = null
    let batchId = null
    if (!dryRun && errors.length === 0 && changedRows.length) {
      batchNo = nextBatchNo()
      const update = db.prepare('UPDATE process_nodes SET planned_start = ?, planned_end = ?, updated_at = datetime(\'now\') WHERE id = ?')
      const items = changedRows.map((item) => ({
        id: item.id,
        status: item.status,
        old_planned_start: item.previous_planned_start,
        old_planned_end: item.previous_planned_end,
        new_planned_start: item.planned_start,
        new_planned_end: item.planned_end,
      }))
      const tx = db.transaction(() => {
        for (const item of changedRows) {
          update.run(item.planned_start, item.planned_end, item.id)
          writtenCount++
        }
        const inserted = db.prepare(`INSERT INTO process_reschedule_batches
            (batch_no, shift_days, instance_id, subsystem_id, only_overdue, anchor_date, node_count, items_json, note)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(batchNo, 0, instanceId, null, 0, null, writtenCount, JSON.stringify(items), 'scheduler apply')
        batchId = inserted.lastInsertRowid
      })
      tx()
    }

    res.json({
      instance_id: instanceId,
      instance_code: inst.instance_code,
      project_start: projectStart,
      node_count: nodes.length,
      schedulable_count: schedulableNodes.length,
      protected_count: protectedNodes.length,
      protected_nodes: protectedSummary,
      dep_count: deps.length,
      written_count: writtenCount,
      changed_count: changedRows.length,
      unchanged_count: changes.length - changedRows.length,
      dry_run: !!dryRun,
      batch_no: batchNo,
      batch_id: batchId,
      errors,
      sample: changes.slice(0, 5),
      full: dryRun ? changes : undefined,
    })
  }

  app.post('/api/equipment_instances/:id/schedule', wrap(scheduleInstance))
  app.get('/api/equipment_instances/:id/schedule', wrap(scheduleInstance))
}

module.exports = { register, PROTECTED_STATUSES }
