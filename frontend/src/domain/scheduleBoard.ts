// frontend/src/domain/scheduleBoard.ts
// 2026-11-04：排程看板的展示逻辑（纯函数，可单测）
//
// 目标：把"状态文案/异常判定/筛选/汇总"从组件里抽出来，组件只负责渲染。
// 异常口径（与仪表盘延误口径对齐）：
//   超期未完成 = planned_end < now 且非终态（completed/cancelled）
//   未排程     = planned_start / planned_end 都为空
//   受阻       = status = blocked

export type NodeStatusTone = 'info' | 'primary' | 'warning' | 'success' | 'danger'

export interface ProcessNodeLike {
  id: number
  sequence?: number | null
  operation_name?: string | null
  status?: string | null
  planned_start?: string | null
  planned_end?: string | null
  estimated_hours?: number | null
  phase_code?: string | null
  assigned_name?: string | null
  workstation_name?: string | null
  equipment_instance_id?: number | null
}

export interface EquipmentGroupLike {
  id?: number
  instance_id?: number
  instance_code?: string
  instance_name?: string
  progress_pct?: number
  nodes?: ProcessNodeLike[]
  process_nodes?: ProcessNodeLike[]
}

export const NODE_STATUS_META: Record<string, { label: string; tone: NodeStatusTone }> = {
  pending: { label: '待开始', tone: 'info' },
  ready: { label: '已就绪', tone: 'primary' },
  in_progress: { label: '进行中', tone: 'warning' },
  paused: { label: '已暂停', tone: 'info' },
  blocked: { label: '受阻', tone: 'danger' },
  delayed: { label: '延期', tone: 'danger' },
  completed: { label: '已完成', tone: 'success' },
  cancelled: { label: '已取消', tone: 'info' },
}

export const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

export function nodeStatusLabel(status?: string | null): string {
  return NODE_STATUS_META[String(status)]?.label || String(status || '未开始')
}

export function nodeStatusTone(status?: string | null): NodeStatusTone {
  return NODE_STATUS_META[String(status)]?.tone || 'info'
}

export function isTerminal(status?: string | null): boolean {
  return TERMINAL_STATUSES.has(String(status))
}

/** 解析 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm[:ss]` 为本地时间；无法解析返回 null */
export function parseScheduleDate(value?: string | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value).trim())
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

export function isUnscheduled(node: ProcessNodeLike): boolean {
  return !node.planned_start && !node.planned_end
}

export function isOverdue(node: ProcessNodeLike, now: Date = new Date()): boolean {
  if (isTerminal(node.status)) return false
  const end = parseScheduleDate(node.planned_end)
  if (!end) return false
  return end.getTime() < now.getTime()
}

/** 超期天数（向下取整，未超期返回 0） */
export function overdueDays(node: ProcessNodeLike, now: Date = new Date()): number {
  const end = parseScheduleDate(node.planned_end)
  if (!end || !isOverdue(node, now)) return 0
  return Math.max(0, Math.floor((now.getTime() - end.getTime()) / 86400000))
}

export type NodePhase = 'done' | 'running' | 'blocked' | 'overdue' | 'unscheduled' | 'upcoming'

export const NODE_PHASE_META: Record<NodePhase, { label: string; tone: NodeStatusTone }> = {
  done: { label: '已完成', tone: 'success' },
  running: { label: '执行中', tone: 'warning' },
  overdue: { label: '超期', tone: 'danger' },
  blocked: { label: '受阻', tone: 'danger' },
  unscheduled: { label: '未排程', tone: 'info' },
  upcoming: { label: '待开始', tone: 'primary' },
}

export function nodePhase(node: ProcessNodeLike, now: Date = new Date()): NodePhase {
  if (String(node.status) === 'completed') return 'done'
  if (String(node.status) === 'blocked') return 'blocked'
  if (isOverdue(node, now)) return 'overdue'
  if (String(node.status) === 'in_progress' || String(node.status) === 'paused') return 'running'
  if (isUnscheduled(node)) return 'unscheduled'
  return 'upcoming'
}

export interface BoardSummary {
  total: number
  completed: number
  running: number
  blocked: number
  overdue: number
  unscheduled: number
  completionRate: number
}

export function summarizeNodes(nodes: ProcessNodeLike[], now: Date = new Date()): BoardSummary {
  const summary: BoardSummary = { total: nodes.length, completed: 0, running: 0, blocked: 0, overdue: 0, unscheduled: 0, completionRate: 0 }
  for (const node of nodes) {
    const phase = nodePhase(node, now)
    if (phase === 'done') summary.completed += 1
    if (phase === 'running') summary.running += 1
    if (phase === 'blocked') summary.blocked += 1
    if (phase === 'overdue') summary.overdue += 1
    if (phase === 'unscheduled') summary.unscheduled += 1
  }
  summary.completionRate = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0
  return summary
}

export interface NodeFilters {
  keyword?: string
  status?: string | null
  onlyAbnormal?: boolean
}

/** 异常 = 超期 / 受阻 / 未排程（"只看异常"开关用） */
export function isAbnormal(node: ProcessNodeLike, now: Date = new Date()): boolean {
  const phase = nodePhase(node, now)
  return phase === 'overdue' || phase === 'blocked' || phase === 'unscheduled'
}

export function filterNodes(nodes: ProcessNodeLike[], filters: NodeFilters, now: Date = new Date()): ProcessNodeLike[] {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return nodes.filter((node) => {
    if (filters.status && String(node.status || '') !== filters.status) return false
    if (filters.onlyAbnormal && !isAbnormal(node, now)) return false
    if (!keyword) return true
    const haystack = [
      node.operation_name,
      node.phase_code,
      node.assigned_name,
      node.workstation_name,
    ].map((item) => String(item || '').toLowerCase()).join(' ')
    return haystack.includes(keyword)
  })
}

export interface EquipmentBoard extends EquipmentGroupLike {
  id: number
  instance_code: string
  instance_name: string
  nodes: ProcessNodeLike[]
  stats: BoardSummary
}

/** 过滤 + 汇总每个实例；没有命中节点实例被丢弃 */
export function buildEquipmentBoard(equipmentList: EquipmentGroupLike[], filters: NodeFilters = {}, now: Date = new Date()): EquipmentBoard[] {
  const boards: EquipmentBoard[] = []
  for (const equipment of equipmentList || []) {
    const rawNodes = equipment.nodes || equipment.process_nodes || []
    const nodes = filterNodes(rawNodes, filters, now)
    if (!nodes.length) continue
    boards.push({
      ...equipment,
      id: Number(equipment.id ?? equipment.instance_id ?? 0),
      instance_code: String(equipment.instance_code || 'N/A'),
      instance_name: String(equipment.instance_name || ''),
      nodes,
      stats: summarizeNodes(nodes, now),
    })
  }
  return boards
}

/** 行主操作：待开始→开始；已完成→无；其余进行中/暂停→完成 */
export function primaryAction(node: ProcessNodeLike): { key: 'start' | 'complete'; label: string } | null {
  if (isTerminal(node.status)) return node.status === 'cancelled' ? null : null
  if (String(node.status) === 'in_progress' || String(node.status) === 'paused' || String(node.status) === 'blocked') {
    return { key: 'complete', label: '完成' }
  }
  return { key: 'start', label: '开始' }
}

/** 计划时间展示：未排程 / 起 ~ 止 */
export function formatPlanRange(node: ProcessNodeLike): string {
  if (isUnscheduled(node)) return '未排程'
  const start = String(node.planned_start || '').slice(5, 16) || '—'
  const end = String(node.planned_end || '').slice(5, 16) || '—'
  return `${start} ~ ${end}`
}

/** 计划时间是否与某周重叠（用于"本周计划"计数；未排程不计） */
export function overlapsWeek(node: ProcessNodeLike, weekStart?: string | null, weekEnd?: string | null): boolean {
  const nodeStart = parseScheduleDate(node.planned_start)
  const nodeEnd = parseScheduleDate(node.planned_end)
  if (!nodeStart && !nodeEnd) return false
  const start = parseScheduleDate(weekStart)
  const end = parseScheduleDate(weekEnd ? `${String(weekEnd).slice(0, 10)} 23:59:59` : null)
  const from = (nodeStart || nodeEnd)!.getTime()
  const to = (nodeEnd || nodeStart)!.getTime()
  if (start && to < start.getTime()) return false
  if (end && from > end.getTime()) return false
  return true
}

/** 周区间标题：2026-11-02 ~ 2026-11-08 */
export function formatWeekLabel(weekStart?: string | null, weekEnd?: string | null): string {
  if (!weekStart) return ''
  const start = String(weekStart).slice(5, 10)
  const end = String(weekEnd || '').slice(5, 10)
  return end ? `${start} ~ ${end}` : start
}

/** 批次记录展示用 */
export function formatBatchScope(batch: { instance_id?: number | null; subsystem_id?: number | null; anchor_date?: string | null; shift_days?: number }): string {
  const parts: string[] = []
  if (batch.anchor_date) parts.push(`对齐 ${batch.anchor_date}`)
  else if (batch.shift_days) parts.push(`顺延 ${batch.shift_days} 天`)
  if (batch.instance_id) parts.push(`项目 #${batch.instance_id}`)
  return parts.join(' · ') || '—'
}
