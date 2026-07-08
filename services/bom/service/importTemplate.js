"use strict";

function getImportTemplate() {
  const columns = [
    "node_ref",
    "parent_ref",
    "parent_id",
    "tier",
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
    ["ROOT", "", "", "0", "", "", "TBM-001", "1", "台", "成品", "", "", "", "", "1", "0", "0", "0", "0", "", "1", "", "", "", "", "A0", "", "", "整机总装"],
    ["MOD-CUTTER", "ROOT", "", "1", "", "", "TBM-001-01", "1", "套", "自制部件", "", "", "", "", "1", "0", "1", "0", "0", "", "1", "101", "A-01", "", "", "A0", "", "", "刀盘组件"],
    ["PART-BOLT", "MOD-CUTTER", "", "2", "", "BOLT-M24", "M24x80", "24", "件", "标准紧固件", "", "", "东明", "A", "1", "0", "0", "0", "0", "", "1", "201", "BIN-01", "18.5", "", "A0", "", "", "采购件"],
    ["RAW-PLATE", "PART-BOLT", "", "3", "", "", "Q235B-PLATE", "1", "件", "自制机加件", "Q235B", "喷塑RAL7035", "", "", "1.05", "0", "0", "0", "0", "", "1", "202", "RAW-01", "320", "15.2", "A0", "", "", "毛坯示例"],
  ];
  const sampleCsv = [columns.join(","), ...sampleRows.map((row) => row.join(","))].join("\n");
  return {
    version: "bom-import-v2",
    columns,
    notes: [
      "推荐使用 node_ref + parent_ref 表达树结构，parent_id 作为兼容字段保留。",
      "tier 0/1/2/3 分别代表 总装/部件/零件外购件/毛坯。",
      "2/3级节点建议至少提供 material_code 或 part_number 之一。",
      "自制件必须填写 material_grade、surface_treatment；外购件建议填写 brand_recommend。",
    ],
    sample_csv: sampleCsv,
  };
}

module.exports = {
  getImportTemplate,
};
