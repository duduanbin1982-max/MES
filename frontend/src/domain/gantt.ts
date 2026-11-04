// frontend/src/domain/gantt.ts
// 2026-11-04：甘特图几何计算（纯函数，可单测）
// 输入节点（planned_start / planned_end）+ 时间窗口 → 条形的 left/width（像素）。

export interface GanttNodeLike {
  id: number
  operation_name?: string | null
  status?: string | null
  phase_code?: string | null
  planned_start?: string | null
  planned_end?: string | null
  estimated_hours?: number | null
  assigned_name?: string | null
  workstation_name?: string | null
}

export interface GanttDay {
  date: string
  day_of_month: number
  weekday: number
  is_weekend: boolean
  is_month_start: boolean
}

export interface GanttScale {
  from: string
  to: string
  dayWidth: number
  days: GanttDay[]
  totalWidth: number
}

export const ZOOM_DAY_WIDTH: Record<'day' | 'week' | 'month', number> = {
  day: 30,
  week: 10,
  month: 4,
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDayString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseDay(value?: string | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function diffDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86400000)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** 月起止：'2026-11-01' ~ '2026-11-30' */
export function monthRange(anchor: Date): { from: string; to: string } {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return { from: toDayString(start), to: toDayString(end) }
}

/** 构造时间轴（含周末、月首标记与总宽度） */
export function buildScale(from: string, to: string, zoom: 'day' | 'week' | 'month'): GanttScale {
  const start = parseDay(from) || new Date()
  const end = parseDay(to) || addDays(start, 30)
  const dayWidth = ZOOM_DAY_WIDTH[zoom] || ZOOM_DAY_WIDTH.day
  const days: GanttDay[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (cursor.getTime() <= end.getTime() && days.length <= 400) {
    const weekday = cursor.getDay()
    days.push({
      date: toDayString(cursor),
      day_of_month: cursor.getDate(),
      weekday,
      is_weekend: weekday === 0 || weekday === 6,
      is_month_start: cursor.getDate() === 1,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return { from: toDayString(start), to: toDayString(end), dayWidth, days, totalWidth: days.length * dayWidth }
}

export interface BarGeometry {
  left: number
  width: number
}

/** 节点条形几何：按日期四舍五入到天；区间外裁剪；没有计划时间返回 null */
export function barGeometry(node: GanttNodeLike, scale: GanttScale): BarGeometry | null {
  const start = parseDay(node.planned_start)
  if (!start) return null
  const end = parseDay(node.planned_end) || start
  const from = parseDay(scale.from)!
  const totalDays = scale.days.length
  let startIndex = diffDays(from, start)
  let endIndex = diffDays(from, end)
  if (endIndex < 0 || startIndex > totalDays - 1) return null
  startIndex = Math.max(0, Math.min(totalDays - 1, startIndex))
  endIndex = Math.max(startIndex, Math.min(totalDays - 1, endIndex))
  return {
    left: startIndex * scale.dayWidth,
    // 单天任务也至少给半天宽度，避免看不见
    width: Math.max((endIndex - startIndex + 1) * scale.dayWidth - 2, scale.dayWidth * 0.6),
  }
}

/** 拖拽 N 天后的新计划时间（保留原时分秒；只有日期时仍是日期） */
export function shiftDates(node: GanttNodeLike, deltaDays: number): { planned_start: string | null; planned_end: string | null } {
  const shift = (value?: string | null) => {
    if (!value) return null
    const text = String(value).trim()
    const match = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(text)
    if (!match) return text
    const date = parseDay(match[1])
    if (!date) return text
    return `${toDayString(addDays(date, deltaDays))}${match[2] || ''}`
  }
  return { planned_start: shift(node.planned_start), planned_end: shift(node.planned_end) }
}

/** 今天在时间轴中的像素位置（不在区间内返回 null） */
export function todayOffset(scale: GanttScale, today: Date = new Date()): number | null {
  const from = parseDay(scale.from)
  if (!from) return null
  const index = diffDays(from, today)
  if (index < 0 || index >= scale.days.length) return null
  return index * scale.dayWidth + scale.dayWidth / 2
}

/** 按天聚合成月份头（用于表头跨列） */
export function monthSegments(scale: GanttScale): Array<{ label: string; days: number; width: number }> {
  const segments: Array<{ label: string; days: number; width: number }> = []
  for (const day of scale.days) {
    const month = day.date.slice(0, 7)
    const last = segments[segments.length - 1]
    if (last && last.label === month) {
      last.days += 1
      last.width += scale.dayWidth
    } else {
      segments.push({ label: month, days: 1, width: scale.dayWidth })
    }
  }
  return segments
}

/** 表头刻度：日视图每天显示日号；周视图每 7 天显示一次；月视图只显示月 */
export function tickLabel(day: GanttDay, zoom: 'day' | 'week' | 'month', index: number): string {
  if (zoom === 'day') return String(day.day_of_month)
  if (zoom === 'week') return index % 7 === 0 ? String(day.day_of_month) : ''
  return day.is_month_start ? String(day.day_of_month) : ''
}

// ------------------------------------------------------------ 依赖箭头
export interface Point {
  x: number
  y: number
}

/** 依赖连线路径：前驱条形右端 → 后继条形左端；目标在左侧时走 S 形回绕 */
export function dependencyPath(from: Point, to: Point): string {
  const delta = Math.abs(to.x - from.x)
  const control = Math.max(12, Math.min(60, delta / 2))
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`
}

/** 箭头样式：两端任一超期/受阻 → 红色告警，否则常规灰蓝 */
export function dependencyTone(fromPhase: string, toPhase: string): 'normal' | 'danger' {
  const risk = new Set(['overdue', 'blocked'])
  return risk.has(fromPhase) || risk.has(toPhase) ? 'danger' : 'normal'
}

export interface DependencyLike {
  id: number
  predecessor_id: number
  successor_id: number
  dep_type?: string | null
  lag_hours?: number | null
}

export interface RectLike {
  left: number
  right: number
  top: number
  height: number
}

/** 把两端的矩形转成箭头端点（前驱右端、后继左端，纵向取中点） */
export function arrowEndpoints(predecessor: RectLike, successor: RectLike): { from: Point; to: Point } {
  return {
    from: { x: predecessor.right, y: predecessor.top + predecessor.height / 2 },
    to: { x: successor.left, y: successor.top + successor.height / 2 },
  }
}
// ------------------------------------------------------------ 选中节点的依赖关系
export type DependencyRelation = 'none' | 'upstream' | 'downstream'

/** 依赖与选中节点的关系：to=选中 → upstream（选中节点是后继）；from=选中 → downstream */
export function dependencyRelation(dep: DependencyLike, selectedId: number | null): DependencyRelation {
  if (selectedId === null || selectedId === undefined) return 'none'
  if (dep.successor_id === selectedId) return 'upstream'
  if (dep.predecessor_id === selectedId) return 'downstream'
  return 'none'
}

/** 直接上下游（一跳）：上游 = 以选中节点为后继的依赖前驱；下游 = 以选中节点为前驱的后继 */
export function neighborIds(dependencies: DependencyLike[], selectedId: number | null): { upstream: number[]; downstream: number[] } {
  if (selectedId === null || selectedId === undefined) return { upstream: [], downstream: [] }
  const upstream = new Set<number>()
  const downstream = new Set<number>()
  for (const dep of dependencies) {
    if (dep.successor_id === selectedId) upstream.add(dep.predecessor_id)
    if (dep.predecessor_id === selectedId) downstream.add(dep.successor_id)
  }
  return {
    upstream: [...upstream].sort((a, b) => a - b),
    downstream: [...downstream].sort((a, b) => a - b),
  }
}

/** 节点在选中上下文中的角色：self / upstream / downstream / none */
export function nodeRelation(nodeId: number, selectedId: number | null, neighbors: { upstream: number[]; downstream: number[] }): 'self' | 'upstream' | 'downstream' | 'none' {
  if (selectedId === null || selectedId === undefined) return 'none'
  if (nodeId === selectedId) return 'self'
  if (neighbors.upstream.includes(nodeId)) return 'upstream'
  if (neighbors.downstream.includes(nodeId)) return 'downstream'
  return 'none'
}