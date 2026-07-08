"use strict";

const BOM_FIELDS = {
  tier: { type: "int", label: "层级(0-3)", required: true },
  material_id: { type: "int", label: "物料ID", required: false },
  part_number: { type: "text", label: "图号/型号", required: false, max: 200 },
  quantity: { type: "real", label: "单台数量", required: true, min: 0.0001 },
  unit: { type: "text", label: "单位", required: true, enum: ["件", "个", "米", "千克", "套", "台", "根", "条", "升"] },
  category: {
    type: "text",
    label: "物料分类",
    required: true,
    enum: ["自制机加件", "自制钣金件", "标准紧固件", "气动元件", "电气元件", "外购成品", "辅助材料", "成品", "自制部件"],
  },
  material_grade: { type: "text", label: "材质牌号", required: false, max: 100 },
  surface_treatment: { type: "text", label: "表面处理", required: false, max: 200 },
  brand_recommend: { type: "text", label: "推荐品牌", required: false, max: 100 },
  brand_grade: { type: "text", label: "品牌等级", required: false, enum: ["A", "B", "不可替代"] },
  operation_id: { type: "int", label: "工序ID", required: false },
  scrap_factor: { type: "real", label: "损耗系数", required: false, default: 1, min: 1, max: 2 },
  is_phantom: { type: "int", label: "虚项", required: false, default: 0 },
  is_key_component: { type: "int", label: "关键件", required: false, default: 0 },
  is_wear_part: { type: "int", label: "易损件", required: false, default: 0 },
  storage_location: { type: "text", label: "存放位置", required: false, max: 100 },
  is_alternative: { type: "int", label: "替代料", required: false, default: 0 },
  alternative_group: { type: "text", label: "替代组", required: false, max: 50 },
  alternative_priority: { type: "int", label: "替代优先级", required: false, default: 1, min: 1 },
  weight: { type: "real", label: "单重kg", required: false, min: 0 },
  unit_price: { type: "real", label: "估价", required: false, min: 0 },
  version: { type: "text", label: "版本", required: false, default: "A0", max: 10 },
  eco_id: { type: "int", label: "ECO ID", required: false },
  effective_from: { type: "text", label: "生效起始", required: false },
  effective_to: { type: "text", label: "生效截止", required: false },
  notes: { type: "text", label: "备注", required: false, max: 500 },
};

const SELF_MADE_CATEGORIES = new Set(["自制机加件", "自制钣金件"]);
const PURCHASED_CATEGORIES = new Set(["标准紧固件", "气动元件", "电气元件", "外购成品"]);
const COMPONENT_CATEGORIES = new Set(["自制部件", "外购成品"]);
const VERSION_RE = /^[A-Z][0-9]+$/;

module.exports = {
  BOM_FIELDS,
  SELF_MADE_CATEGORIES,
  PURCHASED_CATEGORIES,
  COMPONENT_CATEGORIES,
  VERSION_RE,
};
