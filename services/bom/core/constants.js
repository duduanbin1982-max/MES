"use strict";

const BOM_VOCAB = require("../../../shared/bomVocabulary.json");

const BOM_FIELDS = {
  tier: { type: "int", label: "层级(自动)", required: true },
  node_type: {
    type: "text",
    label: "节点类型",
    required: false,
    enum: Object.keys(BOM_VOCAB.nodeTypes),
  },
  level_code: { type: "text", label: "层级号", required: false, max: 80 },
  sort_order: { type: "int", label: "排序", required: false },
  material_id: { type: "int", label: "物料ID", required: false },
  part_number: { type: "text", label: "图号/型号", required: false, max: 200 },
  quantity: { type: "real", label: "单台数量", required: true, min: 0.0001 },
  unit: { type: "text", label: "单位", required: true, enum: BOM_VOCAB.units },
  category: {
    type: "text",
    label: "物料分类",
    required: true,
    enum: BOM_VOCAB.categories,
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

const SELF_MADE_CATEGORIES = new Set(BOM_VOCAB.selfMadeCategories);
const PURCHASED_CATEGORIES = new Set(BOM_VOCAB.purchasedCategories);
const COMPONENT_CATEGORIES = new Set(BOM_VOCAB.componentCategories);
const NODE_TYPES = new Set(Object.keys(BOM_VOCAB.nodeTypes));
const VERSION_RE = /^[A-Z][0-9]+$/;

module.exports = {
  BOM_VOCAB,
  BOM_FIELDS,
  SELF_MADE_CATEGORIES,
  PURCHASED_CATEGORIES,
  COMPONENT_CATEGORIES,
  NODE_TYPES,
  VERSION_RE,
};
