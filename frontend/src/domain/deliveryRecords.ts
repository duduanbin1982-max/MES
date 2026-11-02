// frontend/src/domain/deliveryRecords.ts
// 2026-11-02：交付单 / 验收单的前端展示逻辑（纯函数，可单测）

export type DeliveryStatus = 'planned' | 'shipped' | 'in_transit' | 'arrived' | 'accepted' | 'cancelled'

export const DELIVERY_STATUS_META: Record<string, { label: string; tone: 'info' | 'primary' | 'warning' | 'success' | 'danger' }> = {
  planned: { label: '已计划', tone: 'info' },
  shipped: { label: '已发货', tone: 'primary' },
  in_transit: { label: '运输中', tone: 'warning' },
  arrived: { label: '已到场', tone: 'warning' },
  accepted: { label: '已验收', tone: 'success' },
  cancelled: { label: '已取消', tone: 'danger' },
}

/** 与后端 DELIVERY_TRANSITIONS 保持一致；状态机以后端为准，这里只用于展示可选动作 */
export const DELIVERY_TRANSITIONS: Record<string, string[]> = {
  planned: ['shipped', 'cancelled'],
  shipped: ['in_transit', 'cancelled'],
  in_transit: ['arrived', 'cancelled'],
  arrived: ['accepted', 'cancelled'],
  accepted: [],
  cancelled: [],
}

export const DELIVERY_TYPE_META: Record<string, string> = {
  machine: '整机',
  spare_parts: '备件',
  tools: '工装/工具',
  other: '其它',
}

export const TRANSPORT_MODE_META: Record<string, string> = {
  road: '公路',
  rail: '铁路',
  sea: '海运',
  air: '空运',
}

export const ACCEPTANCE_TYPE_META: Record<string, string> = {
  fat: '厂内验收 (FAT)',
  sat: '现场验收 (SAT)',
  final: '终验',
}

export const ACCEPTANCE_RESULT_META: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: '待验收', tone: 'info' },
  passed: { label: '通过', tone: 'success' },
  conditional: { label: '让步接收', tone: 'warning' },
  rejected: { label: '不通过', tone: 'danger' },
}

export function deliveryStatusLabel(status?: string): string {
  return DELIVERY_STATUS_META[String(status)]?.label || String(status || '-')
}

export function deliveryStatusTone(status?: string): 'info' | 'primary' | 'warning' | 'success' | 'danger' {
  return DELIVERY_STATUS_META[String(status)]?.tone || 'info'
}

/** 当前状态允许推进到的下一步（终态/未知状态返回空数组） */
export function nextDeliveryStatuses(status?: string): string[] {
  return DELIVERY_TRANSITIONS[String(status)] || []
}

export function canTransitionDelivery(from?: string, to?: string): boolean {
  return nextDeliveryStatuses(from).includes(String(to))
}

export function deliveryTypeLabel(type?: string): string {
  return DELIVERY_TYPE_META[String(type)] || String(type || '-')
}

export function transportModeLabel(mode?: string): string {
  return TRANSPORT_MODE_META[String(mode)] || String(mode || '-')
}

export function acceptanceTypeLabel(type?: string): string {
  return ACCEPTANCE_TYPE_META[String(type)] || String(type || '-')
}

export function acceptanceResultLabel(result?: string): string {
  return ACCEPTANCE_RESULT_META[String(result)]?.label || String(result || '-')
}

export function acceptanceResultTone(result?: string): 'info' | 'success' | 'warning' | 'danger' {
  return ACCEPTANCE_RESULT_META[String(result)]?.tone || 'info'
}

/** 验收签署摘要：`张工（客户代表）@ 2026-12-06` */
export function signSummary(item: { signer_name?: string; signer_title?: string; signed_at?: string }): string {
  if (!item || !item.signer_name) return '—'
  const who = item.signer_title ? `${item.signer_name}（${item.signer_title}）` : item.signer_name
  const when = item.signed_at ? String(item.signed_at).slice(0, 16) : ''
  return when ? `${who} @ ${when}` : who
}
