/**
 * GET /api/equipment_instances/:id/subsystems
 *
 * 按 subsystem_id 分组返回工艺树数据，每个 subsystem 一张卡片：
 * - subsystem 元数据（name_zh, name_en, sequence, color）
 * - 该 subsystem 下的节点（嵌套树）
 * - 子系统级统计（total / by_status / progress_pct / critical_path_count）
 */

const all = (db, sql, params = []) => db.prepare(sql).all(params)
const get = (db, sql, params = []) => db.prepare(sql).get(params)

// 9 个子系统的固定颜色（前端色条用）
const SUBSYSTEM_COLORS = {
  1: '#f56c6c',  // 刀盘 - 红
  2: '#e6a23c',  // 主驱动 - 橙
  3: '#409eff',  // 盾体 - 蓝（最大）
  4: '#67c23a',  // 推进系统 - 绿
  5: '#909399',  // 拼装系统 - 灰
  6: '#9b59b6',  // 出渣系统 - 紫
  7: '#1abc9c',  // 液压系统 - 青
  8: '#f39c12',  // 电气控制 - 金
  9: '#34495e',  // 后配套 - 深蓝灰
  null: '#909399' // 未分类 - 灰
}

function getSubsystems(req, res, db) {
  const instanceId = req.params.id
  if (!instanceId) return res.status(400).json({ error: 'instance_id required' })

  const inst = get(db, 'SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?', instanceId)
  if (!inst) return res.status(404).json({ error: 'instance not found' })

  // 拿所有节点 + 物料名（按 subsystem_id + sequence 排序）
  const nodes = all(db, `
    SELECT n.id, n.parent_id, n.subsystem_id, n.operation_name, n.operation_type,
           n.estimated_hours, n.status, n.is_milestone, n.assigned_to,
           n.required_workstation_id, n.sequence, n.sort_order, n.notes,
           m.material_name
    FROM process_nodes n
    LEFT JOIN instance_bom b ON b.id = n.bom_node_id
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE n.equipment_instance_id = ?
    ORDER BY n.subsystem_id NULLS LAST, n.sequence, n.sort_order
  `, instanceId)

  if (!nodes.length) {
    return res.json({ instance_id: instanceId, subsystems: [], uncategorized: [], total_nodes: 0 })
  }

  // 拿依赖边（跨 subsystem 也算）
  const nodeIds = nodes.map(n => n.id)
  const placeholders = nodeIds.map(() => '?').join(',')
  const deps = all(db,
    `SELECT predecessor_id, successor_id, dep_type FROM process_dependencies WHERE predecessor_id IN (${placeholders}) AND successor_id IN (${placeholders})`,
    [...nodeIds, ...nodeIds]
  )

  // 取 critical_path（如果已经查过）
  const cpmRes = all(db,
    'SELECT id FROM process_nodes WHERE equipment_instance_id = ?',
    instanceId
  )
  const criticalSet = new Set()  // 没有时为空，前端不显示 ⭐

  // 按 subsystem 分组
  const bySub = new Map()
  for (const n of nodes) {
    const key = n.subsystem_id  // null 也作为一个 key（"未分类"组）
    if (!bySub.has(key)) bySub.set(key, [])
    bySub.get(key).push(n)
  }

  // 拿 subsystem 元数据
  const subMeta = all(db, 'SELECT id, code, name_zh, name_en, sequence FROM equipment_subsystems')
  const subMetaMap = new Map(subMeta.map(s => [s.id, s]))

  // 构建响应：每个 subsystem 一个卡片
  const subsystemCards = []
  const uncategorized = []

  for (const [subId, subNodes] of bySub.entries()) {
    if (subId == null) {
      // 根节点（总装等）放 uncategorized
      const tree = buildForest(subNodes, deps)
      const stats = computeStats(subNodes, criticalSet)
      uncategorized.push({
        id: null,
        name_zh: '总装/未分类',
        nodes: tree,
        ...stats
      })
      continue
    }
    const meta = subMetaMap.get(subId) || { name_zh: '未知', name_en: 'Unknown', sequence: 99 }
    const tree = buildForest(subNodes, deps)
    const stats = computeStats(subNodes, criticalSet)
    subsystemCards.push({
      id: subId,
      code: meta.code,
      name_zh: meta.name_zh,
      name_en: meta.name_en,
      sequence: meta.sequence,
      color: SUBSYSTEM_COLORS[subId] || '#909399',
      nodes: tree,
      ...stats
    })
  }

  // 按 sequence 排序
  subsystemCards.sort((a, b) => (a.sequence || 99) - (b.sequence || 99))

  // 总计
  const totalNodes = nodes.length
  const completedAll = nodes.filter(n => n.status === 'completed').length

  res.json({
    instance_id: instanceId,
    instance_code: inst.instance_code,
    instance_name: inst.instance_name,
    subsystems: subsystemCards,
    uncategorized,
    total_nodes: totalNodes,
    completed_nodes: completedAll,
    progress_pct: totalNodes ? Math.round(100 * completedAll / totalNodes) : 0
  })
}

function buildForest(nodes, deps) {
  const ids = new Set(nodes.map(n => n.id))
  const childrenOf = new Map()
  for (const n of nodes) {
    const pid = (n.parent_id != null && ids.has(n.parent_id)) ? n.parent_id : null
    if (!childrenOf.has(pid)) childrenOf.set(pid, [])
    childrenOf.get(pid).push(n)
  }
  const build = (parentId) => (childrenOf.get(parentId) || []).map(n => ({
    id: n.id,
    parent_id: n.parent_id,
    operation_name: n.operation_name,
    operation_type: n.operation_type,
    estimated_hours: n.estimated_hours,
    status: n.status,
    is_milestone: !!n.is_milestone,
    assigned_to: n.assigned_to,
    required_workstation_id: n.required_workstation_id,
    notes: n.notes,
    material_name: n.material_name,
    sequence: n.sequence,
    children: build(n.id)
  }))
  return build(null)
}

function computeStats(nodes, criticalSet) {
  const total = nodes.length
  const by_status = { pending: 0, ready: 0, in_progress: 0, completed: 0, blocked: 0, paused: 0, skipped: 0 }
  let critical_count = 0
  let total_hours = 0
  for (const n of nodes) {
    by_status[n.status] = (by_status[n.status] || 0) + 1
    if (criticalSet.has(n.id)) critical_count++
    total_hours += n.estimated_hours || 0
  }
  return {
    total,
    by_status,
    completed: by_status.completed || 0,
    progress_pct: total ? Math.round(100 * (by_status.completed || 0) / total) : 0,
    critical_count,
    total_hours
  }
}

module.exports = { getSubsystems, SUBSYSTEM_COLORS }
