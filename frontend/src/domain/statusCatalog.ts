import catalog from '../../../shared/statusCatalog.json'

type StatusMeta = { label: string; tag: string }
type LifecycleMeta = StatusMeta & { color: string }

export const PURCHASE_ORDER_STATUSES = catalog.purchaseOrder.statuses
export const PURCHASE_ORDER_STATUS_META = catalog.purchaseOrder.meta as Record<string, StatusMeta>
export const PURCHASE_FOLLOWUP_STATUS_META = catalog.purchaseFollowup.meta as Record<string, StatusMeta>
export const SHORTAGE_STATUS_META = catalog.shortage.meta as Record<string, StatusMeta>
export const EQUIPMENT_LIFECYCLE_META = catalog.equipmentLifecycle.meta as Record<string, LifecycleMeta>

export const EQUIPMENT_LIFECYCLE_OPTIONS = Object.entries(EQUIPMENT_LIFECYCLE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
  tag: meta.tag,
}))

export function statusLabel(meta: Record<string, { label: string }>, value?: string) {
  const normalized = value === 'S1' ? catalog.equipmentLifecycle.aliases.S1 : value
  return normalized ? (meta[normalized]?.label || value || '-') : '-'
}

export function statusTag(meta: Record<string, { tag: string }>, value?: string) {
  const normalized = value === 'S1' ? catalog.equipmentLifecycle.aliases.S1 : value
  return normalized ? (meta[normalized]?.tag || 'info') : 'info'
}
