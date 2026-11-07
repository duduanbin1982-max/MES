require('../../middleware/asyncHandler');
/**
 * 工艺树生成 + 关键路径
 *
 * 设计：
 * - 树根节点查找：parent_id IS NULL 节点们（可能多个森林）
 * - 拓扑排序：标准 Kahn 算法，cycle 时收集 orphan
 * - 关键路径：在 DAG 上做正推 ES / 倒推 LS / slack 计算
 *   修正了原代码两个 bug：
 *   1) 根节点硬编码 id=1（instance_id 下 id 可能是 2/3/4...）
 *   2) criticalPath 走树遍历，对共享子节点会重复计算
 *
 * 接口约定：函数签名 (req, res, db)，与 materialPlanner 等保持一致
 */

const all = (db, sql, params = []) => db.prepare(sql).all(params);
const get = (db, sql, params = []) => db.prepare(sql).get(params);


// ─── 辅助：纯函数（无 DB，便于单测）───

/**
 * 在 DAG 节点列表上做拓扑排序
 * @param {Array<{id,parent_id}>} nodes
 * @returns {{sorted:number[], cycleNodes:number[]}}
 */
function topoSort(nodes, dependencies = []) {
  // 真正 Kahn：parent_id 在集合内算入度边，集合外（NULL 或外部 ID）算根
  // 2026-11-07（工艺树审计）：同时把 process_dependencies 纳入拓扑，避免依赖环漏检
  const idSet = new Set(nodes.map(n => n.id));
  const childrenOf = new Map();
  const indeg = new Map();
  for (const n of nodes) {
    childrenOf.set(n.id, []);
    indeg.set(n.id, 0);
  }
  const edges = [];
  for (const n of nodes) {
    if (n.parent_id != null && idSet.has(n.parent_id)) edges.push([n.parent_id, n.id]);
  }
  for (const dep of dependencies || []) {
    if (idSet.has(dep.predecessor_id) && idSet.has(dep.successor_id)) {
      edges.push([dep.predecessor_id, dep.successor_id]);
    }
  }
  for (const [from, to] of edges) {
    childrenOf.get(from).push(to);
    indeg.set(to, indeg.get(to) + 1);
  }
  const queue = [];
  for (const n of nodes) if (indeg.get(n.id) === 0) queue.push(n.id);
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const child of childrenOf.get(id)) {
      indeg.set(child, indeg.get(child) - 1);
      if (indeg.get(child) === 0) queue.push(child);
    }
  }
  const visited = new Set(sorted);
  const cycleNodes = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
  return { sorted, cycleNodes };
}

/**
 * DAG 上的关键路径（CPM）
 * @param {Array<{id,parent_id,duration_days}>} nodes
 * @returns {{projectDuration:number, criticalNodes:number[], allNodes:Array<{id,es,ls,slack}>}}
 */
function computeCPM(nodes, dependencies = []) {
  const { sorted, cycleNodes } = topoSort(nodes, dependencies);
  if (cycleNodes.length) {
    return {
      projectDuration: 0,
      criticalNodes: [],
      allNodes: nodes.map(n => ({ id: n.id, es: 0, ls: 0, slack: 0, inCycle: true })),
      cycleNodes
    };
  }
  const duration = new Map(nodes.map(n => [n.id, n.duration_days || 0]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const n of nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); }
  const addEdge = (from, to, kind, dep) => {
    outgoing.get(from).push({ to, kind, dep });
    incoming.get(to).push({ from, kind, dep });
  };
  for (const n of nodes) {
    if (n.parent_id != null && nodeById.has(n.parent_id)) addEdge(n.parent_id, n.id, "parent", null);
  }
  const depType = (dep) => String(dep?.dep_type || "FS").toUpperCase();
  const lag = (dep) => Number(dep?.lag_hours || 0);
  for (const dep of dependencies || []) {
    if (nodeById.has(dep.predecessor_id) && nodeById.has(dep.successor_id)) {
      addEdge(dep.predecessor_id, dep.successor_id, depType(dep), dep);
    }
  }
  // 正推 ES / EF（同时支持 FS/SS/FF/SF + lag）
  const es = new Map(), ef = new Map();
  for (const id of sorted) {
    let earliest = 0;
    for (const edge of incoming.get(id) || []) {
      const predEs = es.get(edge.from) || 0;
      const predEf = ef.get(edge.from) || 0;
      const successorDuration = duration.get(id) || 0;
      let constraint = 0;
      if (edge.kind === "parent" || edge.kind === "FS") constraint = predEf + lag(edge.dep);
      else if (edge.kind === "SS") constraint = predEs + lag(edge.dep);
      else if (edge.kind === "FF") constraint = predEf + lag(edge.dep) - successorDuration;
      else if (edge.kind === "SF") constraint = predEs + lag(edge.dep) - successorDuration;
      earliest = Math.max(earliest, constraint);
    }
    es.set(id, earliest);
    ef.set(id, earliest + (duration.get(id) || 0));
  }
  const projectDuration = sorted.length ? Math.max(...sorted.map(id => ef.get(id) || 0)) : 0;
  // 倒推 LS / LF（依赖边按语义反向约束前驱）
  const ls = new Map(), lf = new Map();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    let latestFinish = projectDuration;
    const succ = outgoing.get(id) || [];
    if (succ.length) {
      latestFinish = Infinity;
      for (const edge of succ) {
        const succLs = ls.get(edge.to) || 0;
        const succLf = lf.get(edge.to) || 0;
        const predDuration = duration.get(id) || 0;
        let constraint;
        if (edge.kind === "parent" || edge.kind === "FS") constraint = succLs - lag(edge.dep) - predDuration;
        else if (edge.kind === "SS") constraint = succLs - lag(edge.dep);
        else if (edge.kind === "FF") constraint = succLf - lag(edge.dep) - predDuration;
        else if (edge.kind === "SF") constraint = succLf - lag(edge.dep);
        latestFinish = Math.min(latestFinish, constraint + predDuration);
      }
    }
    lf.set(id, latestFinish);
    ls.set(id, latestFinish - (duration.get(id) || 0));
  }
  const allNodes = sorted.map(id => ({
    id,
    es: es.get(id) || 0,
    ls: ls.get(id) || 0,
    slack: (ls.get(id) || 0) - (es.get(id) || 0)
  }));
  return {
    projectDuration,
    criticalNodes: allNodes.filter(n => n.slack === 0).map(n => n.id),
    allNodes,
    cycleNodes: []
  };
}

// ─── HTTP handlers（对外接口：与 server.js 路由约定一致）───

function generateProcessTree(req, res, db) {
  const instanceId = req.params.id;
  if (!instanceId) return res.status(400).json({ error: 'instance_id required' });

  const inst = get(db, 'SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?', instanceId);
  if (!inst) return res.status(404).json({ error: 'instance not found' });

  const nodes = all(db,
    'SELECT id, parent_id, operation_name AS name, estimated_hours AS duration_days, sequence AS sequence_order, is_milestone, subsystem_id FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sequence, sort_order',
    [instanceId]
  );
  if (!nodes.length) {
    return res.json({
      instance_id: instanceId,
      node_count: 0,
      dependency_count: 0,
      roots: [],
      cycle_nodes: [],
      tree: [],
      dependencies: []
    });
  }

  const nodeIds = nodes.map(n => n.id);
  const placeholders = nodeIds.map(() => '?').join(',');
  const deps = all(db,
    `SELECT predecessor_id, successor_id, dep_type AS dependency_type FROM process_dependencies WHERE predecessor_id IN (${placeholders}) AND successor_id IN (${placeholders})`,
    [...nodeIds, ...nodeIds]
  );

  const realRoots = nodes.filter(n => n.parent_id == null || !nodeIds.includes(n.parent_id));

  const { cycleNodes } = topoSort(nodes, deps);

  // 构建 forest 树
  const childrenOf = new Map();
  for (const n of nodes) {
    const pid = (n.parent_id != null && nodeIds.includes(n.parent_id)) ? n.parent_id : null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(n);
  }
  const buildTree = (parentId) => (childrenOf.get(parentId) || []).map(n => ({
    id: n.id,
    name: n.name,
    duration_days: n.duration_days,
    is_milestone: !!n.is_milestone,
    subsystem_id: n.subsystem_id,
    children: buildTree(n.id)
  }));
  const tree = buildTree(null);

  res.json({
    instance_id: instanceId,
    node_count: nodes.length,
    dependency_count: deps.length,
    roots: realRoots.map(r => r.id),
    cycle_nodes: cycleNodes,
    tree,
    dependencies: deps
  });
}

function getCriticalPath(req, res, db) {
  const instanceId = req.params.id;
  if (!instanceId) return res.status(400).json({ error: 'instance_id required' });

  const inst = get(db, 'SELECT id FROM equipment_instances WHERE id = ?', instanceId);
  if (!inst) return res.status(404).json({ error: 'instance not found' });

  const nodes = all(db,
    'SELECT id, parent_id, estimated_hours AS duration_days FROM process_nodes WHERE equipment_instance_id = ?',
    [instanceId]
  );
  const dependencies = all(db,
    'SELECT id, predecessor_id, successor_id, dep_type, lag_hours FROM process_dependencies WHERE equipment_instance_id = ?',
    [instanceId]
  );
  if (!nodes.length) {
    return res.json({
      instance_id: instanceId,
      projectDuration: 0,
      criticalNodes: [],
      allNodes: [],
      cycleNodes: [],
      // 前端期望字段（cpm 对象）
      total_weeks: 0,
      total_days: 0,
      total_hours: 0,
      critical_path: [],
      nodes_with_slack: 0
    });
  }
  const result = computeCPM(nodes, dependencies);
  // Adapter：把 computeCPM 输出映射成前端 ProcessTree.vue 期望的 cpm 字段
  // - 前端用 `cpm.total_weeks / total_days / total_hours / critical_path / nodes_with_slack`
  // - 后端纯函数输出 `projectDuration / criticalNodes / allNodes / cycleNodes`
  // - 工期单位约定：estimated_hours 实际为小时，前端按 1天=8h / 1周=5天 换算
  const totalHours = result.projectDuration;
  const totalDays = totalHours / 8;
  const totalWeeks = totalDays / 5;
  res.json({
    instance_id: instanceId,
    projectDuration: result.projectDuration,
    criticalNodes: result.criticalNodes,
    allNodes: result.allNodes,
    cycleNodes: result.cycleNodes,
    total_weeks: totalWeeks,
    total_days: totalDays,
    total_hours: totalHours,
    critical_path: result.criticalNodes,
    nodes_with_slack: result.allNodes.filter(n => n.slack > 0).length
  });
}

module.exports = {
  generateProcessTree,
  getCriticalPath,
  topoSort,    // 导出供测试
  computeCPM   // 导出供测试
};
