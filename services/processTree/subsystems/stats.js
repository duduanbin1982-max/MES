// 子系统级统计：by_status 各档计数 + completed / progress_pct / critical_count / total_hours
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

module.exports = { computeStats }