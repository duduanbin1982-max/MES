// GET /api/equipment_instances/:id/subsystems
// 按 subsystem_id 分组返回工艺树数据，每个 subsystem 一张卡片
const SUBSYSTEM_COLORS = { 1: '#f56c6c', 2: '#e6a23c', 3: '#409eff', 4: '#67c23a', 5: '#909399', 6: '#9b59b6', 7: '#1abc9c', 8: '#f39c12', 9: '#34495e', null: '#909399' }
const { buildForest } = require('./treeBuilder')
const { computeStats } = require('./stats')

const all = (db, sql, params = []) => db.prepare(sql).all(params)
const get = (db, sql, params = []) => db.prepare(sql).get(params)

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

  // critical_path 暂未计算, 保持空集
  const criticalSet = new Set()

  // 按 subsystem 分组
  const bySub = new Map()
  for (const n of nodes) {
    const key = n.subsystem_id
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

  subsystemCards.sort((a, b) => (a.sequence || 99) - (b.sequence || 99))

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

module.exports = { getSubsystems, SUBSYSTEM_COLORS }