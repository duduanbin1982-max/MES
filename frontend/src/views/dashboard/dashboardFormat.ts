export const numberText = (value: any) => Number(value || 0).toLocaleString('zh-CN')

export const pctText = (value: any) => `${Math.round(Number(value || 0))}%`

export const statusLabel = (status: string) => ({
  design: '设计',
  procurement: '采购',
  manufacturing: '生产',
  assembly: '装配',
  commissioning: '调试',
  shipping: '发运',
  accepted: '已验收',
  acceptance: '验收',
  delivered: '交付',
  operation: '运维',
  archived: '归档',
}[status] || status)

export const statusTagType = (status: string) => ({
  design: 'info',
  procurement: 'warning',
  manufacturing: 'primary',
  assembly: 'primary',
  commissioning: 'success',
  shipping: 'warning',
  accepted: 'success',
  acceptance: 'success',
  delivered: 'success',
  operation: 'primary',
  archived: 'info',
}[status] || 'info')
