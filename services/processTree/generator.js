const { wrap } = require('../../middleware/asyncHandler');
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
const run = (db, sql, params = []) => db.prepare(sql).run(params);


// ─── 辅助：纯函数（无 DB，便于单测）───

/**
 * 在 DAG 节点列表上做拓扑排序
 * @param {Array<{id,parent_id}>} nodes
 * @returns {{sorted:number[], cycleNodes:number[]}}
 */
function topoSort(nodes) {
  // 真正 Kahn：parent_id 在集合内算入度边，集合外（NULL 或外部 ID）算根
  const idSet = new Set(nodes.map(n => n.id));
  const childrenOf = new Map();
  const indeg = new Map();
  for (const n of nodes) {
    childrenOf.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const n of nodes) {
    if (n.parent_id != null && idSet.has(n.parent_id)) {
      childrenOf.get(n.parent_id).push(n.id);
      indeg.set(n.id, indeg.get(n.id) + 1);
    }
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
function computeCPM(nodes) {
  const { sorted, cycleNodes } = topoSort(nodes);
  if (cycleNodes.length) {
    return {
      projectDuration: 0,
      criticalNodes: [],
      allNodes: nodes.map(n => ({ id: n.id, es: 0, ls: 0, slack: 0, inCycle: true })),
      cycleNodes
    };
  }
  const dur = new Map(nodes.map(n => [n.id, n.duration_days || 0]));
  const childrenOf = new Map();
  for (const n of nodes) childrenOf.set(n.id, []);
  for (const n of nodes) {
    if (n.parent_id != null) childrenOf.get(n.parent_id)?.push(n.id);
  }
  // 正推 ES / EF
  const es = new Map(), ef = new Map();
  for (const id of sorted) {
    const parentIds = nodes.filter(n => n.id === id).map(n => n.parent_id).filter(pid => pid != null && es.has(pid));
    const maxParentEf = parentIds.length ? Math.max(...parentIds.map(pid => ef.get(pid))) : 0;
    es.set(id, maxParentEf);
    ef.set(id, maxParentEf + (dur.get(id) || 0));
  }
  const projectDuration = sorted.length ? Math.max(...sorted.map(id => ef.get(id) || 0)) : 0;
  // 倒推 LS / LF
  const ls = new Map(), lf = new Map();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const childIds = (childrenOf.get(id) || []).filter(cid => ls.has(cid));
    const minChildLs = childIds.length ? Math.min(...childIds.map(cid => ls.get(cid))) : projectDuration;
    lf.set(id, minChildLs);
    ls.set(id, minChildLs - (dur.get(id) || 0));
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

  const { cycleNodes } = topoSort(nodes);

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
  const result = computeCPM(nodes);
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
