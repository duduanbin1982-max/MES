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
