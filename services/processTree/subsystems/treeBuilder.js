// 递归构建父子嵌套树，过滤掉 parent_id 指向当前子树外的孤儿引用
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

module.exports = { buildForest }