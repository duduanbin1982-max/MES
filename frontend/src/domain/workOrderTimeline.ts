// frontend/src/domain/workOrderTimeline.ts
// 工单流转抽屉的纯逻辑（2026-10-17 从组件抽出，便于 test:domain 自动覆盖）。
// 交互/渲染留在组件，映射与排序放这里。

export interface WorkflowHistoryRow {
  id?: number
  from_state?: string | null
  to_state?: string | null
  action?: string | null
  actor_id?: number | null
  actor_name?: string | null
  comment?: string | null
  created_at?: string | null
}

export interface WorkflowInstanceRow {
  id?: number
  current_state?: string | null
  history?: WorkflowHistoryRow[] | null
}

export const ACTION_LABELS: Record<string, string> = {
  start: '开工',
  dispatch: '派工',
  pause: '暂停',
  complete: '完工',
  report: '报工',
  cancel: '取消',
  submit: '提交审核',
  approve: '批准',
  reject: '驳回',
  release: '发布',
  revise: '修改重提',
  implement: '实施完成',
  close: '关闭',
  issue: '签发',
  revoke: '收回',
  archive: '归档',
}

export function actionLabel(action?: string | null): string {
  if (!action) return '-'
  return ACTION_LABELS[action] || action
}

/** Element Plus el-tag 的 type 取值 */
export function stateTagType(state?: string | null): 'success' | 'danger' | 'warning' | 'info' {
  if (state === 'completed' || state === 'closed' || state === 'archived') return 'success'
  if (state === 'cancelled' || state === 'rejected' || state === 'revoked') return 'danger'
  if (state === 'in_progress' || state === 'review') return 'warning'
  return 'info'
}

/** 把多个实例的历史拍平，按时间倒序（最新在前）；时间相同按 id 倒序，保证稳定 */
export function flattenHistory(instances?: WorkflowInstanceRow[] | null): WorkflowHistoryRow[] {
  const rows: WorkflowHistoryRow[] = []
  for (const inst of instances || []) {
    for (const h of inst.history || []) rows.push(h)
  }
  return rows.sort((a, b) => {
    const ta = String(a.created_at || '')
    const tb = String(b.created_at || '')
    if (ta !== tb) return tb.localeCompare(ta)
    return (b.id || 0) - (a.id || 0)
  })
}

/** 时间线里最近一次动作（用于列表页摘要） */
export function lastAction(instances?: WorkflowInstanceRow[] | null): WorkflowHistoryRow | null {
  const rows = flattenHistory(instances)
  return rows.length ? rows[0] : null
}
