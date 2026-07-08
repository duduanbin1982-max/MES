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

export function defaultBomForm() {
  return {
    tier: 2,
    quantity: 1,
    unit: '件',
    category: '外购成品',
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

export const DOC_TYPE_LABEL: Record<string, string> = {
  drawing: '📐 图纸',
  sop: '📋 SOP',
  process: '⚙️ 工艺',
  qc_std: '🔍 检验标准',
  contract: '📜 合同',
  report: '📊 报告',
  other: '📝 其他',
}

export function templateDesc(name: string) {
  const map: any = {
    node_ref: '本次导入内的节点引用，用于 parent_ref 挂树',
    parent_ref: '引用前面行的 node_ref，推荐替代 parent_id',
    parent_id: '兼容字段，直接指向已存在 BOM 节点 ID',
    tier: '0总装 / 1部件 / 2零件外购件 / 3毛坯',
    material_id: '优先使用已有物料主数据 ID',
    material_code: '若未填 material_id，则按物料编码反查',
    part_number: '图号/型号',
    quantity: '单台净用量',
    unit: '件/个/米/千克/套/台/根/条/升',
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
