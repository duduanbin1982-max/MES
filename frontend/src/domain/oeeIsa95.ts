// frontend/src/domain/oeeIsa95.ts
// P0-1（2026-10-18）：OEE 的 ISA-95 口径展示用纯函数（可被 test:domain 覆盖）。
// 数据来自 GET /api/oee/overview（basis / losses_by_bucket / sources / data_quality）。

export interface OeeBasis {
  shift_minutes?: number
  planned_stop_minutes?: number
  planned_production_minutes?: number
  run_minutes?: number
  net_run_minutes?: number
  availability_loss_minutes?: number
  performance_loss_minutes?: number
  quality_loss_minutes?: number
}

export interface OeeDataQuality {
  ok?: boolean
  level?: 'ok' | 'mismatch' | 'legacy' | string
  reason?: string | null
  tolerance_pct?: number
  verifiable_shifts?: number
  legacy_shifts?: number
  pass_rate_pct?: number | null
}

export interface LossBucketRow {
  key: string
  label: string
  minutes: number
  pct: number
  status: '' | 'success' | 'warning' | 'exception'
}

const BUCKET_META: Array<{ key: string; label: string; status: LossBucketRow['status'] }> = [
  { key: 'availability', label: '可用率损失', status: 'exception' },
  { key: 'performance', label: '性能损失', status: 'warning' },
  { key: 'quality', label: '质量损失', status: 'warning' },
  { key: 'planned_stop', label: '计划停机', status: 'success' },
]

/** 分钟数 → 易读文本（>= 60 分钟显示小时） */
export function formatMinutes(value?: number | null): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '0 分钟'
  if (n >= 60) {
    const hours = n / 60
    // 整点显示 "9 小时"，否则保留 1 位小数 "8.5 小时"
    return hours % 1 === 0 ? `${hours} 小时` : `${(Math.round(hours * 10) / 10).toFixed(1)} 小时`
  }
  return `${Math.round(n * 10) / 10} 分钟`
}

/** 0~1 的比率 → 百分比文本 */
export function pctText(value?: number | null): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(1)}%`
}

/** 损失分桶 → 进度条数据（pct 相对计划生产时间） */
export function buildLossBuckets(
  byBucket?: Record<string, number> | null,
  plannedProductionMinutes?: number | null,
): LossBucketRow[] {
  const base = Number(plannedProductionMinutes) || 0
  return BUCKET_META.map((meta) => {
    const minutes = Number(byBucket?.[meta.key]) || 0
    const rawPct = base > 0 ? (minutes / base) * 100 : 0
    return {
      key: meta.key,
      label: meta.label,
      minutes,
      pct: Math.min(100, Math.round(rawPct * 10) / 10),
      status: minutes > 0 ? meta.status : '',
    }
  })
}

/** 数据质量 → 徽标（type/label/description） */
export function qualityBadgeOf(dq?: OeeDataQuality | null): {
  type: 'success' | 'warning' | 'danger' | 'info'
  label: string
  description: string
} {
  const level = dq?.level || (dq?.ok ? 'ok' : 'legacy')
  if (level === 'ok') {
    return {
      type: 'success',
      label: '口径可校验',
      description: `损失合计与时间差在 ${dq?.tolerance_pct ?? 2}% 以内`,
    }
  }
  if (level === 'mismatch') {
    return {
      type: 'danger',
      label: '口径不一致',
      description: `差异超过 ${dq?.tolerance_pct ?? 2}%，需核对班次与损失记录`,
    }
  }
  const legacy = Number(dq?.legacy_shifts) || 0
  return {
    type: 'info',
    label: '历史数据待补录',
    description: legacy > 0
      ? `${legacy} 个班次缺三层基线或损失归属不可靠`
      : '缺三层基线数据，无法校验口径',
  }
}

/** 数据来源标签 */
export function sourceLabel(source?: string | null): string {
  if (source === 'manual') return '手工录入'
  if (source === 'iot') return 'IoT 采集'
  if (source === 'system') return '系统推算'
  return source || '未知来源'
}

/** 三层时间基线（展示用，带层级） */
export function buildBasisRows(basis?: OeeBasis | null): Array<{ key: string; label: string; minutes: number; text: string; depth: number }> {
  const b = basis || {}
  return [
    { key: 'shift', label: '班次总时长', minutes: Number(b.shift_minutes) || 0, text: formatMinutes(b.shift_minutes), depth: 0 },
    { key: 'planned_stop', label: '计划停机', minutes: Number(b.planned_stop_minutes) || 0, text: formatMinutes(b.planned_stop_minutes), depth: 1 },
    { key: 'planned_production', label: '计划生产时间', minutes: Number(b.planned_production_minutes) || 0, text: formatMinutes(b.planned_production_minutes), depth: 0 },
    { key: 'availability_loss', label: '可用率损失', minutes: Number(b.availability_loss_minutes) || 0, text: formatMinutes(b.availability_loss_minutes), depth: 1 },
    { key: 'run', label: '实际运行时间', minutes: Number(b.run_minutes) || 0, text: formatMinutes(b.run_minutes), depth: 0 },
    { key: 'performance_loss', label: '性能损失', minutes: Number(b.performance_loss_minutes) || 0, text: formatMinutes(b.performance_loss_minutes), depth: 1 },
    { key: 'net_run', label: '净运行时间', minutes: Number(b.net_run_minutes) || 0, text: formatMinutes(b.net_run_minutes), depth: 0 },
  ]
}
