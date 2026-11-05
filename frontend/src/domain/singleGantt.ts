// frontend/src/domain/singleGantt.ts
// 2026-11-05（审计 F-02）：单项目甘特时间轴
// 关键修正：月份列宽必须按"该月真实天数"算，而不是固定 30 天——否则条形会落在错误月份下。
// （原实现：monthWidth = 30 * 8px，条形 left = 真实天数 * 8px → 到 11 月错位 24px）

export interface TimelineMonth {
  key: string
  label: string
  days: number
  width: number
  left: number
}

export interface TimelineModel {
  months: TimelineMonth[]
  totalWidth: number
  totalDays: number
  todayLeft: number | null
}

export interface BarLike {
  start?: string | null
  end?: string | null
  planned_start?: string | null
  planned_end?: string | null
}

const MS_PER_DAY = 86400000

export function parseDateLoose(value?: string | null): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDayString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * 构建"真实日历"时间轴：
 *   · 按月切列，但每列宽度 = 该月落在区间内的真实天数 × dayWidth
 *   · 首尾月按区间裁剪（例如 7-15 开始，则 7 月列只有 17 天宽）
 */
export function buildTimeline(projectStart: string | null | undefined, projectEnd: string | null | undefined, dayWidth: number, minDays = 7): TimelineModel {
  const start = parseDateLoose(projectStart)
  const end = parseDateLoose(projectEnd)
  if (!start || !end || end < start) {
    const fallbackDays = Math.max(1, minDays)
    return {
      months: [{ key: 'empty', label: '—', days: fallbackDays, width: fallbackDays * dayWidth, left: 0 }],
      totalWidth: fallbackDays * dayWidth,
      totalDays: fallbackDays,
      todayLeft: null,
    }
  }
  const firstDay = startOfDay(start)
  const lastDay = startOfDay(end)
  const totalDays = Math.round((lastDay.getTime() - firstDay.getTime()) / MS_PER_DAY) + 1
  const months: TimelineMonth[] = []
  let cursor = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1)
  let left = 0
  while (cursor.getTime() <= lastDay.getTime()) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const segmentStart = monthStart < firstDay ? firstDay : monthStart
    const segmentEnd = monthEnd > lastDay ? lastDay : monthEnd
    const days = Math.max(0, Math.round((segmentEnd.getTime() - segmentStart.getTime()) / MS_PER_DAY) + 1)
    if (days > 0) {
      months.push({
        key: `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`,
        label: `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`,
        days,
        width: days * dayWidth,
        left,
      })
      left += days * dayWidth
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  const today = startOfDay(new Date())
  const todayOffsetDays = Math.round((today.getTime() - firstDay.getTime()) / MS_PER_DAY)
  const todayLeft = todayOffsetDays >= 0 && todayOffsetDays < totalDays ? todayOffsetDays * dayWidth : null

  return { months, totalWidth: left, totalDays, todayLeft }
}

/** 条形几何：按真实天数定位；宽度至少 8px，避免极短任务看不见 */
export function barRect(bar: BarLike, projectStart: string | null | undefined, dayWidth: number): { left: number; width: number } | null {
  const start = parseDateLoose(bar.start || bar.planned_start)
  if (!start) return null
  const end = parseDateLoose(bar.end || bar.planned_end) || start
  const project = parseDateLoose(projectStart)
  if (!project) return null
  const offsetDays = (startOfDay(start).getTime() - startOfDay(project).getTime()) / MS_PER_DAY
  const spanDays = Math.max(0, (end.getTime() - start.getTime()) / MS_PER_DAY)
  const width = Math.max(8, (spanDays || 0.5) * dayWidth)
  return { left: Math.round(offsetDays * dayWidth), width: Math.round(width) }
}

/** 月份表头是否显示日号（首月显示开始日，其余显示 01） */
export function monthLabelSuffix(month: TimelineMonth, index: number): string {
  if (index === 0) return month.label
  return month.label
}

/** 计划跨度展示：2026-07-01 → 2026-11-11（134 天） */
export function formatSpanLabel(projectStart?: string | null, projectEnd?: string | null, totalDays?: number): string {
  if (!projectStart) return '—'
  const start = String(projectStart).slice(0, 10)
  const end = projectEnd ? String(projectEnd).slice(0, 10) : '—'
  return `${start} → ${end}${totalDays ? `（${totalDays} 天）` : ''}`
}
