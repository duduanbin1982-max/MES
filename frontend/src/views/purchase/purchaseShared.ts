import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_META, PURCHASE_FOLLOWUP_STATUS_META, statusLabel, statusTag } from '../../domain/statusCatalog'

export const poStatuses = PURCHASE_ORDER_STATUSES
export const poStatusLabel = (status: string) => statusLabel(PURCHASE_ORDER_STATUS_META, status)
export const poStatusTag = (status: string) => statusTag(PURCHASE_ORDER_STATUS_META, status)
export const followUpStatusLabel = (value: string) => statusLabel(PURCHASE_FOLLOWUP_STATUS_META, value)
export const followUpStatusTag = (value: string) => statusTag(PURCHASE_FOLLOWUP_STATUS_META, value)
export const supplierName = (supplier: any) => supplier.supplier_name || supplier.name || supplier.supplier_code || `供应商#${supplier.id}`
export const supplierCategoryTag = (value: string) => ({ key_component: 'danger', outsourcing: 'warning', standard_part: 'success', raw_material: 'info', service: 'primary' } as any)[value] || 'info'
export const outsourceStatusLabel = (status: string) => ({ planned: '计划', processing: '进行中', completed: '已完成', cancelled: '已取消' } as any)[status] || status
export const outsourceStatusTag = (status: string) => ({ planned: 'info', processing: 'warning', completed: 'success', cancelled: 'danger' } as any)[status] || ''
export const scoreGradeTag = (grade: string) => ({ A: 'success', B: '', C: 'warning', D: 'danger' } as any)[grade] || 'info'
