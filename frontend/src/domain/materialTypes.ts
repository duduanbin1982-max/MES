export const MATERIAL_TYPE_OPTIONS = [
  { value: 'steel', label: '钢材' },
  { value: 'raw', label: '原材料' },
  { value: 'welding', label: '焊材' },
  { value: 'fastener', label: '紧固件' },
  { value: 'bought_part', label: '外购件' },
  { value: 'purchased', label: '外购件' },
  { value: 'machining', label: '机加件' },
  { value: 'sheet_metal', label: '钣金件' },
  { value: 'electrical', label: '电气件' },
  { value: 'hydraulic', label: '液压件' },
  { value: 'seal', label: '密封件' },
  { value: 'pneumatic', label: '气动件' },
  { value: 'hardware', label: '五金件' },
  { value: 'standard', label: '标准件' },
  { value: 'auxiliary', label: '辅料' },
] as const

const TYPE_LABELS: Record<string, string> = Object.fromEntries(MATERIAL_TYPE_OPTIONS.map((item) => [item.value, item.label]))

export function materialTypeLabel(value?: string | null): string {
  if (!value) return '-'
  return TYPE_LABELS[String(value)] || String(value)
}
