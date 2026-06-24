/**
 * 节点状态机工具（纯函数）
 *
 * 设计：
 * - 后端 /process_progress 给的 by_status 是「真实数据库 status」
 * - 但 ready/blocked 在后端计算可能用 BOM/物料交期/前序状态的不同口径
 * - 前端在装饰阶段用依赖图算一个 derived status 用于 UI 徽章（不写库）
 *
 * 输入：
 * - node: 当前节点（含 status）
 * - predecessors: 来自 process_dependencies 的所有依赖边 [{predecessor_id, successor_id, dep_type}]
 * - flatMap: 全实例平铺节点 [{id, status, ...}]
 *
 * 输出（不改 node.status）：
 * - derived: 'ready' | 'blocked' | 'pending' | 'in_progress' | 'completed' | 'paused' | 'skipped'
 *
 * 规则：
 * - completed/in_progress/paused/skipped → 直接沿用 node.status（已被显式操作）
 * - ready（已确认前序全完成）
 * - blocked（任一硬依赖 predecessor 未完成且非 skipped）
 * - pending（默认）
 */

export function deriveNodeStatus(node, predecessors, flatMap) {
  // 终态/进行态：保持原值
  const TERMINAL = ['completed', 'in_progress', 'paused', 'skipped']
  if (TERMINAL.includes(node.status)) return node.status

  // 找所有「前置节点」
  const myPreds = predecessors.filter(d => d.successor_id === node.id)
  if (myPreds.length === 0) return 'ready'  // 无前置默认可开始

  // 检查硬依赖（dep_type === 'FS' 完成→开始）
  const fsPreds = myPreds.filter(d => (d.dep_type || 'FS') === 'FS')
  if (fsPreds.length === 0) return 'ready'

  const flatById = new Map(flatMap.map(n => [n.id, n]))
  for (const dep of fsPreds) {
    const pred = flatById.get(dep.predecessor_id)
    if (!pred) continue  // 前置在 instance 外，跳过
    if (pred.status !== 'completed' && pred.status !== 'skipped') {
      return 'blocked'
    }
  }
  return 'ready'
}

/**
 * 给一组节点 + 依赖批量算 derived status
 * 一次遍历，避免每个节点都查 flatMap
 */
export function decorateWithDerivedStatus(nodes, predecessors, flatMap) {
  const flatById = new Map(flatMap.map(n => [n.id, n]))
  const predIndex = new Map()  // successor_id → [predecessor_id, dep_type]
  for (const d of predecessors) {
    if (!predIndex.has(d.successor_id)) predIndex.set(d.successor_id, [])
    predIndex.get(d.successor_id).push(d)
  }
  return nodes.map(n => {
    const myPreds = predIndex.get(n.id) || []
    const fsPreds = myPreds.filter(d => (d.dep_type || 'FS') === 'FS')
    let derived = n.status
    const TERMINAL = ['completed', 'in_progress', 'paused', 'skipped']
    if (!TERMINAL.includes(n.status)) {
      if (fsPreds.length === 0) {
        derived = 'ready'
      } else {
        const allDone = fsPreds.every(d => {
          const p = flatById.get(d.predecessor_id)
          return !p || p.status === 'completed' || p.status === 'skipped'
        })
        derived = allDone ? 'ready' : 'blocked'
      }
    }
    return { ...n, derived_status: derived }
  })
}

/**
 * 过滤器：按 searchKey / workstation / onlyMine / onlyCritical 过滤节点
 * 同时返回哪些父节点需要保留（即使自身不匹配，祖先也要保留以显示树形结构）
 */
export function filterTree(tree, options = {}) {
  const { searchKey = '', onlyCritical = false, onlyMine = null, workstationId = null, criticalSet = new Set() } = options
  const kw = String(searchKey || '').trim().toLowerCase()
  const matches = (n) => {
    if (onlyCritical && !criticalSet.has(n.id)) return false
    if (onlyMine != null && n.assigned_to !== onlyMine) return false
    if (workstationId != null && n.required_workstation_id !== workstationId) return false
    if (kw) {
      const hay = `${n.operation_name || ''} ${n.material_name || ''} ${n.notes || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  }
  const walk = (nodes) => {
    const out = []
    for (const n of nodes) {
      const kids = walk(n.children || [])
      if (matches(n) || kids.length > 0) {
        out.push({ ...n, children: kids })
      }
    }
    return out
  }
  return walk(tree)
}

// ─── C 方案：节点视觉分级 + 进度聚合 ───

// 工序类型 → 色条（typeBar 颜色）
export const TYPE_COLOR = {
  make: '#409eff',     // 制造 - 蓝
  buy: '#e6a23c',      // 采购 - 橙
  assemble: '#67c23a', // 装配 - 绿
  qc: '#f56c6c',       // 质检 - 红
  test: '#909399',     // 测试 - 灰
  default: '#dcdfe6'
}

// 子系统 → 色条（与后端 SUBSYSTEM_COLORS 一致）
export const SUBSYSTEM_COLOR = {
  1: '#f56c6c', 2: '#e6a23c', 3: '#409eff', 4: '#67c23a', 5: '#909399',
  6: '#9b59b6', 7: '#1abc9c', 8: '#f39c12', 9: '#34495e',
  null: '#909399'
}

/**
 * 计算节点层级深度（根=1，叶子递增）
 * @param {Array} tree 嵌套树
 * @param {number} targetId 目标节点 id
 * @returns {number} 深度（未找到返回 0）
 */
export function nodeDepth(tree, targetId) {
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.id === targetId) return depth
      if (n.children && n.children.length) {
        const r = walk(n.children, depth + 1)
        if (r) return r
      }
    }
    return 0
  }
  return walk(tree, 1)
}

/**
 * 递归聚合子树进度
 * @param {Object} node 节点（含 children）
 * @param {Map} flatById id → flatNode 映射（用于 derived_status）
 * @returns {{total:number, completed:number, inProgress:number, blocked:number, ready:number}}
 */
export function aggregateProgress(node, flatById) {
  let total = 1, completed = 0, inProgress = 0, blocked = 0, ready = 0
  // 用 derived_status（flatById 提供）或 db status
  const flat = flatById.get(node.id)
  const status = flat?.derived_status || flat?.status || node.status || 'pending'
  if (status === 'completed') completed++
  else if (status === 'in_progress') inProgress++
  else if (status === 'blocked') blocked++
  else if (status === 'ready') ready++
  for (const c of (node.children || [])) {
    const sub = aggregateProgress(c, flatById)
    total += sub.total
    completed += sub.completed
    inProgress += sub.inProgress
    blocked += sub.blocked
    ready += sub.ready
  }
  return { total, completed, inProgress, blocked, ready }
}

/**
 * 给一组节点打 derived_status + 子进度聚合（一次性遍历，性能友好）
 * 用于 ProcessTreeSubsystemCard 内部
 */
export function decorateNodesWithDerivedAndProgress(nodes, predecessors, flatById) {
  const predIndex = new Map()
  for (const d of predecessors) {
    if (!predIndex.has(d.successor_id)) predIndex.set(d.successor_id, [])
    predIndex.get(d.successor_id).push(d)
  }
  // 第一遍：算 derived
  const decorated = nodes.map(n => {
    const myPreds = predIndex.get(n.id) || []
    const fsPreds = myPreds.filter(d => (d.dep_type || 'FS') === 'FS')
    let derived = n.status
    const TERMINAL = ['completed', 'in_progress', 'paused', 'skipped']
    if (!TERMINAL.includes(n.status)) {
      if (fsPreds.length === 0) derived = 'ready'
      else {
        const allDone = fsPreds.every(d => {
          const p = flatById.get(d.predecessor_id)
          return !p || p.status === 'completed' || p.status === 'skipped'
        })
        derived = allDone ? 'ready' : 'blocked'
      }
    }
    return { ...n, derived_status: derived }
  })
  // 第二遍：把 flatById 注入 derived 版本（供子树聚合）
  const decoratedById = new Map(decorated.map(n => [n.id, n]))
  // 子树聚合
  const decorateProgress = (n) => {
    const stats = aggregateProgress(n, decoratedById)
    return {
      ...n,
      progress: stats,
      children: (n.children || []).map(decorateProgress)
    }
  }
  return decorated.map(decorateProgress)
}
