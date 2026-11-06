/**
 * PATCH /api/process_nodes/:id/subsystem
 *
 * 改单个节点的 subsystem_id
 * - 允许 null（移到未分类组）
 * - 校验 subsystem_id 在 equipment_subsystems 表里存在（null 跳过校验）
 * - 返回更新后的字段
 * 2026-11-07（工艺树审计）：补写审计日志（归属调整可追溯）。
 */

const audit = require('../../app/audit')

const get = (db, sql, params = []) => db.prepare(sql).get(params)
const run = (db, sql, params = []) => db.prepare(sql).run(params)

function patchNodeSubsystem(req, res, db) {
  const nodeId = req.params.id
  if (!nodeId) return res.status(400).json({ error: 'node id required' })

  // 校验 body
  const body = req.body || {}
  const newSubId = body.subsystem_id
  if (newSubId !== null && typeof newSubId !== 'number') {
    return res.status(400).json({ error: 'subsystem_id must be number or null' })
  }

  // 校验节点存在
  const node = get(db, 'SELECT id, equipment_instance_id, subsystem_id FROM process_nodes WHERE id = ?', nodeId)
  if (!node) return res.status(404).json({ error: 'node not found' })

  // 校验 subsystem 存在（null 跳过）
  if (newSubId != null) {
    const sub = get(db, 'SELECT id, name_zh FROM equipment_subsystems WHERE id = ?', newSubId)
    if (!sub) return res.status(400).json({ error: 'subsystem_id ' + newSubId + ' not found' })
  }

  // 更新
  run(db, "UPDATE process_nodes SET subsystem_id = ?, updated_at = datetime('now') WHERE id = ?", [newSubId, nodeId])

  // 返回更新后的节点
  const after = get(db,
    `SELECT n.id, n.subsystem_id, es.name_zh as subsystem_name
     FROM process_nodes n
     LEFT JOIN equipment_subsystems es ON es.id = n.subsystem_id
     WHERE n.id = ?`, nodeId)

  audit.record(db, req, {
    action: 'process_node.subsystem.update',
    resource_type: 'process_node',
    resource_id: nodeId,
    before: { subsystem_id: node.subsystem_id },
    after: { subsystem_id: newSubId },
    diff_summary: `工序节点 ${nodeId} 子系统 ${node.subsystem_id} -> ${newSubId}`,
  })

  res.json({
    ok: true,
    node: after,
    previous_subsystem_id: node.subsystem_id
  })
}

module.exports = { patchNodeSubsystem }
