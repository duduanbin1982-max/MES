// frontend/src/domain/costVariance.ts
// P2-2（2026-10-19）：成本三层差异展示逻辑（纯函数，可被 test:domain 覆盖）。

export interface VarianceTotals {
  standard_cost?: number
  actual_cost?: number
  quantity_variance?: number
  price_variance?: number
  efficiency_variance?: number
  rate_variance?: number
  total_variance?: number
  overspend?: boolean
  variance_pct?: number | null
  confidence?: 'full' | 'partial' | string
  reconciled?: boolean
}

export interface NotComputed {
  quantity?: Array<{ name?: string; key?: string; standard_cost?: number; standard_qty?: number; reason?: string }>
  labor?: Array<{ reason?: string; standard_hours?: number; standard_cost?: number }>
}

/** 差异金额 → 语义：超支（正）/ 节约（负）/ 持平 */
export function varianceKind(value?: number | null): 'over' | 'under' | 'flat' {
  const n = Number(value) || 0
  if (n > 0.004) return 'over'
  if (n < -0.004) return 'under'
  return 'flat'
}

export function varianceLabel(value?: number | null): string {
  const kind = varianceKind(value)
  if (kind === 'over') return '超支'
  if (kind === 'under') return '节约'
  return '持平'
}

export function varianceTone(value?: number | null): string {
  const kind = varianceKind(value)
  if (kind === 'over') return 'text-danger'
  if (kind === 'under') return 'text-success'
  return 'text-info'
}

/** 带符号金额（万元口径不转换，直接元） */
export function signedMoney(value?: number | null): string {
  const n = Number(value) || 0
  const text = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n > 0.004) return '+' + text
  if (n < -0.004) return '-' + text
  return text
}

/** 可信度徽标：full=完整 / partial=部分数据缺失 */
export function confidenceTag(confidence?: string | null): { type: 'success' | 'warning'; label: string } {
  if (confidence === 'full') return { type: 'success', label: '数据完整' }
  return { type: 'warning', label: '部分数据缺失' }
}

/** "未计入"摘要：未领料 N 项（标准金额 X）/ 人工未计入 */
export function notComputedSummary(notComputed?: NotComputed | null): string[] {
  const lines: string[] = []
  const qty = notComputed?.quantity || []
  if (qty.length) {
    const amount = qty.reduce((sum, item) => sum + (Number(item.standard_cost) || 0), 0)
    lines.push(`${qty.length} 种物料未领料（标准金额 ${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元），量差未计入`)
  }
  if ((notComputed?.labor || []).length) lines.push('人工效率差未计入（无报工或报工覆盖不足）')
  return lines
}

/** Top 贡献项文案 */
export function contributorText(item?: { name?: string; total_variance?: number } | null): string {
  if (!item) return '-'
  const name = item.name || '未命名'
  return `${name}（${signedMoney(item.total_variance)} 元）`
}
