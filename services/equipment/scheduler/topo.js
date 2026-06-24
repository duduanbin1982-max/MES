// 拓扑排序: Kahn 算法 + 环检测
// 入参: nodes (process_nodes 列表) + deps (process_dependencies 列表, 含 successor_id / predecessor_id / dep_type / lag_hours)
// 返回: { topo: number[], cyclic: number[] }
//   - topo: 拓扑序 (空数组若无节点)
//   - cyclic: 参与环的节点 id 列表 (空数组若无环)
function topologicalSort(nodes, deps) {
  const inDeg = {}
  const succMap = {}
  for (const n of nodes) inDeg[n.id] = 0
  for (const d of deps) {
    if (inDeg[d.successor_id] !== undefined) inDeg[d.successor_id]++
    (succMap[d.predecessor_id] = succMap[d.predecessor_id] || []).push(d)
  }
  const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
  const topo = []
  while (queue.length) {
    const id = queue.shift()
    topo.push(id)
    for (const d of (succMap[id] || [])) {
      inDeg[d.successor_id]--
      if (inDeg[d.successor_id] === 0) queue.push(d.successor_id)
    }
  }
  if (topo.length < nodes.length) {
    const cyclic = nodes.filter(n => !topo.includes(n.id)).map(n => n.id)
    return { topo: [], cyclic }
  }
  return { topo, cyclic: [] }
}

module.exports = { topologicalSort }