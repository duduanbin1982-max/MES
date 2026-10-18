// frontend/src/domain/workload.ts
// P2-1（2026-10-19）：工位负荷展示逻辑（纯函数，可被 test:domain 覆盖）。
// 数据来源：GET /api/resources/gantt → heatmap.grid（工位 × 日）+ bottlenecks（Top3）+ items

export interface HeatCell {
  day: string
  busy_hours: number
  capacity_hours: number
  utilization_pct: number
  level: 'overload' | 'busy' | 'normal' | 'idle' | string
}

export interface HeatRow {
  ws_id: number
  name: string
  workshop?: string
  daily_capacity_hours: number
  total_busy_hours: number
  avg_utilization_pct: number
  cells: HeatCell[]
}

export interface BottleneckItem {
  ws_id: number
  name: string
  workshop?: string
  avg_utilization_pct: number
  peak_utilization_pct: number
  peak_day?: { day?: string } | string
  total_busy_hours: number
  daily_capacity_hours: number
}

/** 热力格等级 → Element Plus 类型 + 中文标签 */
export function heatLevelTag(level?: string): { type: 'danger' | 'warning' | 'success' | 'info'; label: string } {
  if (level === 'overload') return { type: 'danger', label: '超载' }
  if (level === 'busy') return { type: 'warning', label: '繁忙' }
  if (level === 'normal') return { type: 'success', label: '正常' }
  return { type: 'info', label: '空闲' }
}

/** 热力格配色 class（用于单元格背景） */
export function heatLevelClass(level?: string): string {
  if (level === 'overload') return 'heat-overload'
  if (level === 'busy') return 'heat-busy'
  if (level === 'normal') return 'heat-normal'
  return 'heat-idle'
}

/** 利用率 → 语义色 class */
export function loadToneClass(pct?: number): string {
  const n = Number(pct) || 0
  if (n >= 100) return 'text-danger'
  if (n >= 80) return 'text-warning'
  return 'text-success'
}

/** 小时数格式化（1 位小数） */
export function formatHours(value?: number | null): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '0h'
  return `${Math.round(n * 10) / 10}h`
}

/** 单元格文案：9.2h / 115% */
export function cellText(cell?: HeatCell | null): string {
  if (!cell) return '-'
  return `${formatHours(cell.busy_hours)} / ${cell.utilization_pct}%`
}

/** 峰值日显示（兼容对象/字符串两种形态） */
export function peakDayText(peak?: BottleneckItem['peak_day']): string {
  if (!peak) return '-'
  if (typeof peak === 'string') return peak
  return peak.day || '-'
}

/** 日期列表截断（窗口很长时只展示前 N 天，避免表格横向爆炸） */
export function limitDays(days?: string[] | null, max = 31): { shown: string[]; hidden: number } {
  const list = days || []
  if (list.length <= max) return { shown: list, hidden: 0 }
  return { shown: list.slice(0, max), hidden: list.length - max }
}

/** 取某工位某日"有哪些任务"（用于点击格子查看/改派） */
export function pickCellItems(items: any[] | null | undefined, wsId?: number | null, day?: string): any[] {
  if (!items || !day || wsId === undefined || wsId === null) return []
  return items.filter((item) => {
    if (Number(item.ws_id) !== Number(wsId)) return false
    const start = String(item.start_date || item.start || '').slice(0, 10)
    const end = String(item.end_date || item.end || '').slice(0, 10)
    if (!start && !end) return false
    return start <= day && (end || start) >= day
  })
}
