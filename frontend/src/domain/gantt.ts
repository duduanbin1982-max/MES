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
    // 单天任务也至少给半天宽度，且不低于 8px（月视图 4px/天时仍能看见）
    width: Math.max((endIndex - startIndex + 1) * scale.dayWidth - 2, Math.max(8, scale.dayWidth * 0.6)),
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

/** lag 小时数换算成时间轴像素（1 天 = dayWidth 像素） */
export function lagOffsetPx(lagHours: number | null | undefined, dayWidth: number): number {
  const hours = Number(lagHours)
  if (!Number.isFinite(hours) || hours <= 0 || !dayWidth) return 0
  return (hours / 24) * dayWidth
}

/**
 * 带 lag 的箭头几何（2026-11-05）。
 * FS 语义：后继在前驱结束 + lag 之后才能开始，所以箭头起点从"前驱右端"右移 lag 的像素距离，
 * 与后继条形之间留出一段可见空隙，避免多条线挤在同一个 x 上。
 * 非 FS 类型暂不偏移（当前数据全是 FS）。
 */
export function arrowGeometry(
  predecessor: RectLike,
  successor: RectLike,
  options: { dayWidth: number; lagHours?: number | null; depType?: string | null },
): { from: Point; to: Point; lagged: boolean; lag_px: number } {
  const base = arrowEndpoints(predecessor, successor)
  const depType = String(options.depType ?? 'FS').toUpperCase()
  const lagPx = depType === 'FS' ? lagOffsetPx(options.lagHours, options.dayWidth) : 0
  if (!lagPx) return { from: base.from, to: base.to, lagged: false, lag_px: 0 }
  // 起点最多推到"后继起点前 6px"，保证箭头仍然可见
  const startX = Math.min(base.from.x + lagPx, Math.max(base.from.x + 2, base.to.x - 6))
  return { from: { x: startX, y: base.from.y }, to: base.to, lagged: true, lag_px: lagPx }
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
// ------------------------------------------------------------ N 跳依赖链展开
export interface ChainResult {
  /** nodeId -> 跳数（1 = 直接前驱/后继） */
  upstream: Map<number, number>
  downstream: Map<number, number>
  upstreamIds: number[]
  downstreamIds: number[]
  /** 超过 protectLimit 时截断（避免"全部"展开爆量） */
  truncated: boolean
}

/**
 * 展开选中节点的依赖链（BFS，逐跳扩散；自动防环）。
 * maxDepth = 1 即"只取直接上下游"，Infinity / 'all' 表示一直展开到边界。
 */
export type ChainDirection = 'both' | 'upstream' | 'downstream'

export function expandChain(
  dependencies: DependencyLike[],
  selectedId: number | null,
  maxDepth: number = 1,
  protectLimit = 300,
  direction: ChainDirection = 'both',
): ChainResult {
  const upstream = new Map<number, number>()
  const downstream = new Map<number, number>()
  if (selectedId === null || selectedId === undefined) {
    return { upstream, downstream, upstreamIds: [], downstreamIds: [], truncated: false }
  }
  const depthLimit = Number.isFinite(maxDepth) ? Math.max(1, Math.floor(maxDepth)) : Number.POSITIVE_INFINITY
  const preds = new Map<number, number[]>()
  const succs = new Map<number, number[]>()
  for (const dep of dependencies) {
    if (!preds.has(dep.successor_id)) preds.set(dep.successor_id, [])
    preds.get(dep.successor_id)!.push(dep.predecessor_id)
    if (!succs.has(dep.predecessor_id)) succs.set(dep.predecessor_id, [])
    succs.get(dep.predecessor_id)!.push(dep.successor_id)
  }

  const walk = (edges: Map<number, number[]>, store: Map<number, number>) => {
    let frontier = [selectedId]
    let depth = 1
    while (frontier.length && depth <= depthLimit) {
      const next: number[] = []
      for (const current of frontier) {
        for (const neighbor of edges.get(current) || []) {
          if (neighbor === selectedId || store.has(neighbor)) continue
          store.set(neighbor, depth)
          next.push(neighbor)
          if (store.size + upstream.size + downstream.size >= protectLimit) return true
        }
      }
      frontier = next
      depth += 1
    }
    return false
  }

  // 2026-11-05：支持单向展开（只看上游 / 只看下游）
  let truncated = false
  if (direction !== 'downstream') truncated = walk(preds, upstream)
  if (!truncated && direction !== 'upstream') truncated = walk(succs, downstream)

  return {
    upstream,
    downstream,
    upstreamIds: [...upstream.keys()].sort((a, b) => a - b),
    downstreamIds: [...downstream.keys()].sort((a, b) => a - b),
    truncated,
  }
}

export interface HopInfo {
  relation: 'none' | 'upstream' | 'downstream'
  depth: number
}

/** 节点在依赖链里的位置：自身 / 上游(第几跳) / 下游(第几跳) / 无关 */
export function nodeHop(nodeId: number, selectedId: number | null, chain: ChainResult): HopInfo {
  if (selectedId === null || selectedId === undefined) return { relation: 'none', depth: 0 }
  if (nodeId === selectedId) return { relation: 'none', depth: 0 }
  const up = chain.upstream.get(nodeId)
  if (up) return { relation: 'upstream', depth: up }
  const down = chain.downstream.get(nodeId)
  if (down) return { relation: 'downstream', depth: down }
  return { relation: 'none', depth: 0 }
}

/**
 * 依赖线在链里的位置（跳数 = 线另一端节点的跳数 + 1）。
 * 上游线看后继节点：后继是选中节点自己 → 第 1 跳；后继在 upstream(d) → 第 d+1 跳。
 * 下游线看前驱节点：前驱是选中节点自己 → 第 1 跳；前驱在 downstream(d) → 第 d+1 跳。
 */
export function arrowHop(dep: DependencyLike, selectedId: number | null, chain: ChainResult): HopInfo {
  if (selectedId === null || selectedId === undefined) return { relation: 'none', depth: 0 }
  const upDepth = dep.successor_id === selectedId ? 0 : chain.upstream.get(dep.successor_id)
  const downDepth = dep.predecessor_id === selectedId ? 0 : chain.downstream.get(dep.predecessor_id)
  // 环里可能两边都命中，取更近的一侧
  if (upDepth !== undefined && downDepth !== undefined) {
    return upDepth <= downDepth
      ? { relation: 'upstream', depth: upDepth + 1 }
      : { relation: 'downstream', depth: downDepth + 1 }
  }
  if (upDepth !== undefined) return { relation: 'upstream', depth: upDepth + 1 }
  if (downDepth !== undefined) return { relation: 'downstream', depth: downDepth + 1 }
  return { relation: 'none', depth: 0 }
}
// ------------------------------------------------------------ 条形标签摆放（2026-11-05）
export interface LabelPlacement {
  mode: 'inside' | 'outside-right' | 'outside-left'
  estimated_width: number
}

/**
 * 决定条形文字放哪：
 *   条形够宽（≥ insideMin）→ 放条形内部；
 *   放不下 → 放条形右侧；右侧空间不够 → 放左侧；两侧都不行 → 内部截断。
 * charWidth 为 12px 字号下单字宽的经验值，gap 为线条/条形的间距。
 */
export function labelPlacement(options: {
  barLeft: number
  barWidth: number
  trackWidth: number
  textLength: number
  charWidth?: number
  insideMin?: number
  gap?: number
}): LabelPlacement {
  const charWidth = options.charWidth ?? 7
  const insideMin = options.insideMin ?? 56
  const gap = options.gap ?? 8
  const textLength = Math.max(1, Math.min(options.textLength || 0, 40))
  const estimatedWidth = Math.ceil(textLength * charWidth) + 8
  if (options.barWidth >= insideMin) return { mode: 'inside', estimated_width: estimatedWidth }
  const rightSpace = options.trackWidth - (options.barLeft + options.barWidth) - gap
  if (rightSpace >= estimatedWidth) return { mode: 'outside-right', estimated_width: estimatedWidth }
  const leftSpace = options.barLeft - gap
  if (leftSpace >= estimatedWidth) return { mode: 'outside-left', estimated_width: estimatedWidth }
  return { mode: 'inside', estimated_width: estimatedWidth }
}