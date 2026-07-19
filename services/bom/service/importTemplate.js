"use strict";

function getImportTemplate() {
  const columns = [
    "node_ref",
    "parent_ref",
    "parent_id",
    "tier",
    "node_type",
    "level_code",
    "sort_order",
    "material_id",
    "material_code",
    "part_number",
    "quantity",
    "unit",
    "category",
    "material_grade",
    "surface_treatment",
    "brand_recommend",
    "brand_grade",
    "scrap_factor",
    "is_phantom",
    "is_key_component",
    "is_wear_part",
    "is_alternative",
    "alternative_group",
    "alternative_priority",
    "operation_id",
    "storage_location",
    "unit_price",
    "weight",
    "version",
    "effective_from",
    "effective_to",
    "notes",
  ];
  const sampleRows = [
    ["ROOT", "", "", "0", "equipment", "0", "10", "", "", "TBM-001", "1", "台", "成品", "", "", "", "", "1", "0", "0", "0", "0", "", "1", "", "", "", "", "A0", "", "", "整机总装"],
    ["SYS-CUTTER", "ROOT", "", "1", "system", "01", "10", "", "", "TBM-001-01", "1", "套", "自制部件", "", "", "", "", "1", "0", "1", "0", "0", "", "1", "101", "A-01", "", "", "A0", "", "", "刀盘系统"],
    ["ASM-CUTTER-BODY", "SYS-CUTTER", "", "2", "assembly", "01-01", "10", "", "", "TBM-001-01-001", "1", "套", "自制部件", "", "", "", "", "1", "1", "1", "0", "0", "", "1", "101", "A-01", "", "", "A0", "", "", "刀盘本体组件"],
    ["PART-BOLT", "ASM-CUTTER-BODY", "", "3", "standard", "01-01-01", "10", "", "BOLT-M24", "M24x80", "24", "件", "标准紧固件", "", "", "东明", "A", "1", "0", "0", "0", "0", "", "1", "201", "BIN-01", "18.5", "", "A0", "", "", "采购件"],
    ["RAW-PLATE", "ASM-CUTTER-BODY", "", "3", "raw_material", "01-01-02", "20", "", "", "Q235B-PLATE", "1", "件", "原材料", "Q235B", "喷塑RAL7035", "", "", "1.05", "0", "0", "0", "0", "", "1", "202", "RAW-01", "320", "15.2", "A0", "", "", "毛坯示例"],
  ];
  const sampleCsv = [columns.join(","), ...sampleRows.map((row) => row.join(","))].join("\n");
  return {
    version: "bom-import-v2",
    columns,
    notes: [
      "推荐使用 node_ref + parent_ref 表达树结构，parent_id 作为兼容字段保留。",
      "tier 可按树深度继续增加；系统会根据父节点重算 tier 与 level_code。",
      "node_type 推荐使用 equipment/system/assembly/component/virtual/self_made/purchased/standard/raw_material。",
      "零件/基础件节点建议至少提供 material_code 或 part_number 之一。",
      "自制件必须填写 material_grade、surface_treatment；外购件建议填写 brand_recommend。",
    ],
    sample_csv: sampleCsv,
  };
}

module.exports = {
  getImportTemplate,
};
