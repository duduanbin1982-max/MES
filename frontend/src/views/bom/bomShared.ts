import vocabulary from '../../../../shared/bomVocabulary.json'

export function emptyBusinessViews() {
  return {
    summary: {},
    purchase: { items: [], contract_diff: { items: [] } },
    assembly: { components: [], kit_summary: {}, kit_risks: [] },
    raw: { items: [] },
    cost: { by_category: [], top_items: [] },
    process: { summary: {}, components: [] },
  }
}

export const DOC_TYPE_LABEL: Record<string, string> = vocabulary.docTypeLabels
export const NODE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(vocabulary.nodeTypes).map(([value, meta]: any) => [value, meta.label])
)
export const NODE_TYPE_OPTIONS = Object.entries(vocabulary.nodeTypes).map(([value, meta]: any) => ({
  value,
  label: meta.label,
}))
export const CATEGORY_OPTIONS = [...vocabulary.categories]
export const UNIT_OPTIONS = [...vocabulary.units]
export const TIER_LABELS: Record<string, string> = vocabulary.tierLabels

export function tierLabel(tier: number) {
  return TIER_LABELS[String(tier)] || `${tier} 深层`
}

export function nodeTypeLabel(value: string) {
  return NODE_TYPE_LABEL[value] || value || '-'
}

export function tierPreset(tier: number) {
  return vocabulary.tierPresets[String(tier)] || vocabulary.tierPresets.default
}

export function nodeTypePreset(nodeType: string) {
  return vocabulary.nodeTypes[nodeType] || null
}

export function defaultBomForm() {
  const preset = tierPreset(1)
  return {
    tier: 1,
    node_type: preset.node_type,
    level_code: '',
    sort_order: 0,
    quantity: 1,
    unit: preset.unit,
    category: preset.category,
    material_id: null,
    part_number: '',
    material_grade: '',
    surface_treatment: '',
    brand_recommend: '',
    brand_grade: '',
    scrap_factor: 1.0,
    unit_price: null,
    storage_location: '',
    is_phantom: false,
    is_key_component: false,
    is_wear_part: false,
    notes: '',
    parent_id: null,
  }
}

export function contractDiffLabel(status: string) {
  return vocabulary.contractDiffLabels[status] || '待签合同'
}

export function kitRiskLabel(status: string) {
  return vocabulary.kitRiskLabels[status] || '待到货'
}

export function processLabel(status: string) {
  return vocabulary.processStatusLabels[status] || '待完善'
}

export function processTagType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'danger') return 'danger'
  return 'warning'
}

export function kitRiskTagType(status: string) {
  if (status === 'ready') return 'success'
  if (status === 'blocked') return 'danger'
  return 'warning'
}

export function contractDiffTagType(status: string) {
  if (status === 'on_or_under_budget') return 'success'
  if (status === 'over_20pct') return 'danger'
  if (status === 'over_budget') return 'warning'
  return 'info'
}

export function riskOwnerLabel(row: any) {
  return row?.full_name || row?.username || `用户#${row?.id}`
}

export function templateDesc(name: string) {
  const map: Record<string, string> = {
    node_ref: '本次导入内的节点引用，用于 parent_ref 挂树',
    parent_ref: '引用前面行的 node_ref，推荐替代 parent_id',
    parent_id: '兼容字段，直接指向已存在 BOM 节点 ID',
    tier: '树深度，系统会按父节点自动重算',
    node_type: 'equipment/system/assembly/component/virtual/self_made/purchased/standard/raw_material',
    level_code: '层级号，如 0 / 01 / 01-01，系统自动维护',
    sort_order: '同父节点内排序，系统自动维护',
    material_id: '优先使用已有物料主数据 ID',
    material_code: '若未填 material_id，则按物料编码反查',
    part_number: '图号/型号',
    quantity: '单台净用量',
    unit: vocabulary.units.join('/'),
    category: '物料分类',
    material_grade: '自制件必填',
    surface_treatment: '自制件必填',
    brand_recommend: '外购件建议填写',
    brand_grade: 'A/B/不可替代',
    scrap_factor: '默认 1.0',
    operation_id: '关联工艺路线/工序',
    unit_price: '采购估价/标准成本基础',
    notes: '左右件、配作、易损等说明',
  }
  return map[name] || '-'
}
