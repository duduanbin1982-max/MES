// frontend/src/domain/statusCatalog.ts
// Keep UI labels/colors aligned with backend app/domain/statusCatalog.js.

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'confirmed',
  'in_transit',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const

export const PURCHASE_ORDER_STATUS_META: Record<string, { label: string; tag: string }> = {
  draft: { label: '草稿', tag: 'info' },
  submitted: { label: '已提交', tag: 'warning' },
  confirmed: { label: '已确认', tag: 'primary' },
  in_transit: { label: '运输中', tag: 'warning' },
  partially_received: { label: '部分收货', tag: 'warning' },
  received: { label: '已收货', tag: 'success' },
  closed: { label: '已关闭', tag: 'success' },
  cancelled: { label: '已取消', tag: 'danger' },
  pending: { label: '待审批', tag: 'warning' },
  approved: { label: '已审批', tag: 'primary' },
}

export const PURCHASE_FOLLOWUP_STATUS_META: Record<string, { label: string; tag: string }> = {
  pending: { label: '待跟催', tag: 'warning' },
  following: { label: '跟催中', tag: 'primary' },
  delivered: { label: '已交付', tag: 'success' },
  cancelled: { label: '已取消', tag: 'info' },
}

export const SHORTAGE_STATUS_META: Record<string, { label: string; tag: string }> = {
  open: { label: '未分派', tag: 'info' },
  assigned: { label: '已分派', tag: 'primary' },
  purchasing: { label: '采购中', tag: 'warning' },
  arrived: { label: '已到货', tag: 'primary' },
  closed: { label: '已关闭', tag: 'success' },
  cancelled: { label: '已取消', tag: 'danger' },
}

export const EQUIPMENT_LIFECYCLE_META: Record<string, { label: string; tag: string; color: string }> = {
  design: { label: '设计中', tag: 'info', color: '#909399' },
  procurement: { label: '采购中', tag: 'warning', color: '#e6a23c' },
  manufacturing: { label: '制造中', tag: 'primary', color: '#409eff' },
  assembly: { label: '总装中', tag: 'primary', color: '#409eff' },
  commissioning: { label: '调试中', tag: 'success', color: '#e6a23c' },
  acceptance: { label: '验收中', tag: 'warning', color: '#e6a23c' },
  delivered: { label: '交付', tag: 'success', color: '#67c23a' },
  operation: { label: '运维', tag: 'success', color: '#67c23a' },
  archived: { label: '已归档', tag: 'danger', color: '#909399' },
  S1: { label: '设计中', tag: 'info', color: '#909399' },
}

export function statusLabel(meta: Record<string, { label: string }>, value?: string) {
  return value ? (meta[value]?.label || value) : '-'
}

export function statusTag(meta: Record<string, { tag: string }>, value?: string) {
  return value ? (meta[value]?.tag || 'info') : 'info'
}
