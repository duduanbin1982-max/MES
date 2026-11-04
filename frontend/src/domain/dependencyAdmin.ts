// frontend/src/domain/dependencyAdmin.ts
// 2026-11-05：依赖维护表单的纯逻辑（类型文案、lag 展示、草稿校验）

export const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'] as const

export type DepType = (typeof DEP_TYPES)[number]

export const DEP_TYPE_META: Record<string, { label: string; hint: string }> = {
  FS: { label: '完成-开始', hint: '前驱完成后，后继才能开始（最常见）' },
  SS: { label: '开始-开始', hint: '前驱开始后，后继才能开始' },
  FF: { label: '完成-完成', hint: '前驱完成后，后继才能完成' },
  SF: { label: '开始-完成', hint: '前驱开始后，后继才能完成（少见）' },
}

export const MAX_LAG_HOURS = 8760

export function depTypeLabel(type?: string | null): string {
  const key = String(type || 'FS').toUpperCase()
  return DEP_TYPE_META[key]?.label || key
}

export function depTypeHint(type?: string | null): string {
  const key = String(type || 'FS').toUpperCase()
  return DEP_TYPE_META[key]?.hint || ''
}

/** lag 展示：0 → 无间隔；<24h → 小时；整 8 小时也可显示天 */
export function formatLagHours(hours?: number | null): string {
  const value = Number(hours) || 0
  if (value <= 0) return '无间隔'
  if (value % 24 === 0) return `${value / 24} 天`
  if (value > 24) return `${Math.round((value / 24) * 10) / 10} 天（${value}h）`
  return `${value} 小时`
}

export interface DependencyDraft {
  predecessor_id?: number | null
  successor_id?: number | null
  dep_type?: string | null
  lag_hours?: number | null
}

/** 前端草稿校验（后端还有环检测等强校验，这里先挡明显错误） */
export function validateDependencyDraft(draft: DependencyDraft): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const predecessor = Number(draft.predecessor_id) || 0
  const successor = Number(draft.successor_id) || 0
  if (!predecessor) errors.push('请选择前驱工序')
  if (!successor) errors.push('请选择后继工序')
  if (predecessor && predecessor === successor) errors.push('前驱与后继不能是同一道工序')
  const type = String(draft.dep_type || 'FS').toUpperCase()
  if (!DEP_TYPES.includes(type as DepType)) errors.push(`类型必须是 ${DEP_TYPES.join(' / ')}`)
  const lag = Number(draft.lag_hours ?? 0)
  if (!Number.isFinite(lag) || lag < 0) errors.push('间隔必须是不小于 0 的数字')
  else if (lag > MAX_LAG_HOURS) errors.push(`间隔不能超过 ${MAX_LAG_HOURS} 小时`)
  return { ok: errors.length === 0, errors }
}

/** 工序下拉展示：`#135 下料（已就绪）` */
export function nodeOptionLabel(node: { id: number; operation_name?: string | null; status?: string | null }): string {
  const name = node?.operation_name || '（未命名工序）'
  const statusMap: Record<string, string> = {
    pending: '待开始',
    ready: '已就绪',
    in_progress: '进行中',
    paused: '已暂停',
    blocked: '受阻',
    completed: '已完成',
    cancelled: '已取消',
  }
  const status = node?.status ? statusMap[String(node.status)] || String(node.status) : ''
  return `#${node?.id ?? '?'} ${name}${status ? `（${status}）` : ''}`
}
