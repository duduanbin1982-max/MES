// frontend/src/domain/traceChain.ts
// P0-2（2026-10-18）：追溯五级链路的展示用纯函数（可被 test:domain 覆盖）。
// 数据来自 GET /api/trace/chain 与 /api/trace/chain/coverage。

export type ChainLevelStatus = 'ok' | 'partial' | 'missing'

export interface ChainLevelRow {
  level: number
  key: string
  label: string
  count: number
  status: ChainLevelStatus | string
}

export interface ChainGap {
  level: number
  issue: string
  action: string
}

const STATUS_META: Record<string, { type: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
  ok: { type: 'success', label: '有证据' },
  partial: { type: 'warning', label: '结构在·无数据' },
  missing: { type: 'danger', label: '锚点缺失' },
}

export function levelStatusMeta(status?: string | null): { type: 'success' | 'warning' | 'info' | 'danger'; label: string } {
  return STATUS_META[status || ''] || { type: 'info', label: '未知' }
}

/** 覆盖率进度条状态：>=80 绿 / >=40 黄 / 其余红 */
export function coverageStatus(pct?: number | null): 'success' | 'warning' | 'exception' {
  const n = Number(pct) || 0
  if (n >= 80) return 'success'
  if (n >= 40) return 'warning'
  return 'exception'
}

/** 断点摘要：总数 + 前 N 条（用于折叠展示） */
export function gapSummary(gaps?: ChainGap[] | null, limit = 3): { total: number; head: ChainGap[] } {
  const list = gaps || []
  return { total: list.length, head: list.slice(0, limit) }
}

const ANCHOR_META: Record<string, { label: string; placeholder: string }> = {
  serial_no: { label: '序列号', placeholder: '如 SN-0001' },
  lot_no: { label: '批次号', placeholder: '如 LOT-2026-001' },
  instance_code: { label: '装备编码', placeholder: '如 TBM-2026-001' },
  wo_code: { label: '工单号', placeholder: '如 WO-001' },
}

export function anchorMeta(kind?: string | null): { label: string; placeholder: string } {
  return ANCHOR_META[kind || ''] || { label: '编号', placeholder: '请输入编号' }
}

/** 证据计数 → 一行摘要文本 */
export function evidenceSummary(counts?: Record<string, number> | null): string {
  const c = counts || {}
  const parts = [
    ['检验', c.inspections],
    ['工单检验', c.work_order_qc],
    ['焊缝', c.welds],
    ['NDT', c.ndt],
    ['装配', c.assemblies],
    ['文档', c.documents],
  ]
  return parts.map(([label, n]) => `${label} ${Number(n) || 0}`).join(' · ')
}
