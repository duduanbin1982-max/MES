"use strict";

const {
  BOM_FIELDS,
  SELF_MADE_CATEGORIES,
  PURCHASED_CATEGORIES,
  COMPONENT_CATEGORIES,
  NODE_TYPES,
  VERSION_RE,
} = require("./constants");
const { normalizeInt, normalizeFloat, normalizeBool, cleanText } = require("./utils");
const { tierSummary, structureSummary } = require("./tree");

function validateDateRange(node, errors) {
  if (!node.effective_from || !node.effective_to) return;
  const from = Date.parse(node.effective_from);
  const to = Date.parse(node.effective_to);
  if (!Number.isNaN(from) && !Number.isNaN(to) && from > to) {
    errors.push("effective_from 不能晚于 effective_to");
  }
}

function validateNode(node, ctx = {}) {
  const errors = [];
  const warnings = [];
  const tier = normalizeInt(node.tier, -1);
  const quantity = normalizeFloat(node.quantity, null);
  const unit = cleanText(node.unit);
  const category = cleanText(node.category);
  const partNumber = cleanText(node.part_number);
  const materialId = normalizeInt(node.material_id, null);
  const parentId = normalizeInt(node.parent_id, null);
  const nodeType = cleanText(node.node_type);
  const version = cleanText(node.version);
  const scrapFactor = normalizeFloat(node.scrap_factor, 1);
  const isAlternative = normalizeBool(node.is_alternative);
  const alternativeGroup = cleanText(node.alternative_group);
  const enforceStructure = Boolean(ctx.enforceStructure || ctx.parentById || ctx.materialIds);

  if (!Number.isInteger(tier) || tier < 0) errors.push("tier 必须是 >= 0 的整数");
  if (nodeType && !NODE_TYPES.has(nodeType)) errors.push("node_type 必须是: " + [...NODE_TYPES].join("/"));
  if (!(quantity > 0)) errors.push("quantity 必须 > 0");
  if (!unit) errors.push("unit 必填");
  else if (!BOM_FIELDS.unit.enum.includes(unit)) errors.push("unit 必须是: " + BOM_FIELDS.unit.enum.join("/"));
  if (!category) errors.push("category 必填");
  else if (!BOM_FIELDS.category.enum.includes(category)) errors.push("category 必须是: " + BOM_FIELDS.category.enum.join("/"));
  if (node.parent_id && node.id && Number(node.parent_id) === Number(node.id)) errors.push("parent_id 不能等于自身 id");
  if (scrapFactor < 1 || scrapFactor > 2) errors.push("scrap_factor 应在 1.0-2.0");
  if (version && !VERSION_RE.test(version)) warnings.push("version 建议使用 A0/A1/B0 这类格式");
  validateDateRange(node, errors);

  if (tier === 0) {
    if (parentId) errors.push("0级总装节点不应有父节点");
    if (category && category !== "成品") warnings.push("0级总装节点分类建议为 成品");
    if (quantity !== null && quantity !== 1) warnings.push("0级总装节点数量通常应为 1");
  } else {
    if (enforceStructure && !parentId && !ctx.allowParentless) errors.push("非根节点必须有父节点");
    if (tier === 1 && category && !COMPONENT_CATEGORIES.has(category) && !normalizeBool(node.is_phantom)) {
      warnings.push("1级部件分类建议使用 自制部件/外购成品");
    }
    if (enforceStructure && tier >= 2 && !materialId && !partNumber && !normalizeBool(node.is_phantom)) {
      errors.push("零件/基础件节点必须填写 material_id 或 part_number");
    }
  }

  if (SELF_MADE_CATEGORIES.has(category)) {
    if (!cleanText(node.material_grade)) errors.push("自制件必须填写 material_grade");
    if (!cleanText(node.surface_treatment)) errors.push("自制件必须填写 surface_treatment");
  }

  if (PURCHASED_CATEGORIES.has(category)) {
    if (!cleanText(node.brand_recommend)) warnings.push("外购件建议填写 brand_recommend");
  }

  if (isAlternative && !alternativeGroup) {
    errors.push("替代料必须填写 alternative_group");
  }

  // 2026-11-07（BOM 审计）：金额/重量/替代优先级不允许负数或非法值
  const unitPrice = normalizeFloat(node.unit_price, null);
  if (unitPrice !== null && unitPrice < 0) errors.push("unit_price 不能为负数");
  const weight = normalizeFloat(node.weight, null);
  if (weight !== null && weight < 0) errors.push("weight 不能为负数");
  const alternativePriority = normalizeInt(node.alternative_priority, null);
  if (alternativePriority !== null && alternativePriority < 1) errors.push("alternative_priority 必须是 >= 1 的整数");

  if (ctx.materialIds && materialId && !ctx.materialIds.has(materialId)) {
    errors.push(`物料不存在: material_id=${materialId}`);
  }

  if (ctx.parentById && parentId) {
    const parent = ctx.parentById.get(parentId);
    if (!parent) errors.push(`父节点不存在: ${parentId}`);
    else {
      const parentTier = normalizeInt(parent.tier, -1);
      if (tier !== parentTier + 1) {
        errors.push(`层级关系错误: 当前 tier=${tier}, 父节点 tier=${parentTier}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateMinimumThreeLevel(_db, _instanceId, rows) {
  const errors = [];
  const warnings = [];
  const summary = tierSummary(rows);
  const roots = rows.filter((r) => Number(r.tier) === 0 && (r.parent_id === null || Number(r.parent_id) === 0));
  if (summary[0] < 1) errors.push("最低结构缺失: 0级整机/总装节点");
  if (summary[1] < 1) errors.push("最低结构缺失: 1级部件/模组节点");
  if (summary[2] < 1) errors.push("最低结构缺失: 2级零件/外购件节点");
  if (roots.length !== 1) errors.push(`0级整机根节点必须且只能有 1 个, 当前 ${roots.length} 个`);

  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const row of rows) {
    const tier = Number(row.tier);
    const parentId = normalizeInt(row.parent_id, null);
    if (tier === 0 && parentId) errors.push(`层级关系错误: 0级节点 bom_id=${row.id} 不应有父节点`);
    if (tier > 0) {
      const parent = byId.get(parentId);
      if (!parent) errors.push(`层级关系错误: bom_id=${row.id} 缺少有效父节点`);
      else if (tier < Number(parent.tier) || tier - Number(parent.tier) > 1) {
        errors.push(`层级关系错误: bom_id=${row.id} tier=${tier} 的父节点 tier=${parent.tier}`);
      }
    }
    if (tier === 1 && !COMPONENT_CATEGORIES.has(row.category || "") && !normalizeBool(row.is_phantom)) {
      warnings.push(`建议: 1级部件 bom_id=${row.id} 分类应为 自制部件/外购成品`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, summary, required_tiers: [0, 1, 2] };
}

function detectDuplicates(rows) {
  const byMaterialParent = new Map();
  const byPartNumber = new Map();
  for (const row of rows) {
    const parentKey = normalizeInt(row.parent_id, 0);
    const matKey = row.material_id ? `${parentKey}:${row.material_id}` : null;
    const pnKey = row.part_number ? `${parentKey}:${String(row.part_number).trim()}` : null;
    if (matKey) {
      const arr = byMaterialParent.get(matKey) || [];
      arr.push(row.id);
      byMaterialParent.set(matKey, arr);
    }
    if (pnKey) {
      const arr = byPartNumber.get(pnKey) || [];
      arr.push(row.id);
      byPartNumber.set(pnKey, arr);
    }
  }
  return {
    duplicateMaterialNodes: [...byMaterialParent.entries()].filter(([, ids]) => ids.length > 1),
    duplicatePartNumbers: [...byPartNumber.entries()].filter(([, ids]) => ids.length > 1),
  };
}

function validateTree(db, instanceId, rowsArg = null) {
  const errors = [];
  const warnings = [];
  const rows = rowsArg || db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  const roots = rows.filter((r) => Number(r.tier) === 0 && (r.parent_id === null || Number(r.parent_id) === 0));
  if (roots.length === 0) errors.push("缺少根节点 (tier=0)");
  if (roots.length > 1) errors.push(`多个根节点 (${roots.length}), 应只有 1 个`);

  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const materialIds = new Set(
    (db.prepare("SELECT id FROM materials").all() || []).map((m) => Number(m.id))
  );

  const visiting = new Set();
  const visited = new Set();
  let cycleFound = false;
  function walk(id) {
    if (visiting.has(id)) {
      errors.push(`循环引用: id=${id}`);
      cycleFound = true;
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    const row = byId.get(id);
    for (const child of rows.filter((r) => normalizeInt(r.parent_id, null) === id)) {
      walk(Number(child.id));
    }
    visiting.delete(id);
    visited.add(id);
    return row;
  }
  for (const row of rows) walk(Number(row.id));
  for (const row of rows) {
    if (!visited.has(Number(row.id)) && !cycleFound) errors.push(`孤儿节点: id=${row.id} parent_id=${row.parent_id} 指向不存在`);
  }

  for (const row of rows) {
    const nodeValidation = validateNode(row, { parentById: byId, materialIds, allowParentless: Number(row.tier) === 0 });
    errors.push(...nodeValidation.errors.map((msg) => `bom_id=${row.id}: ${msg}`));
    warnings.push(...nodeValidation.warnings.map((msg) => `bom_id=${row.id}: ${msg}`));
    if (normalizeBool(row.is_phantom)) {
      const hasChildren = rows.some((child) => normalizeInt(child.parent_id, null) === Number(row.id));
      if (!hasChildren) errors.push(`虚项 (bom_id=${row.id}) 必须是父节点, 不能是叶子`);
    }
  }

  const structure = validateMinimumThreeLevel(db, instanceId, rows);
  errors.push(...structure.errors);
  warnings.push(...structure.warnings);

  const duplicates = detectDuplicates(rows);
  for (const [key, ids] of duplicates.duplicateMaterialNodes) warnings.push(`同父节点下 material 重复: ${key} -> ${ids.join(",")}`);
  for (const [key, ids] of duplicates.duplicatePartNumbers) warnings.push(`同父节点下 part_number 重复: ${key} -> ${ids.join(",")}`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    total: rows.length,
    tier_summary: structure.summary,
    structure_summary: structureSummary(rows),
    required_tiers: structure.required_tiers,
  };
}

module.exports = {
  validateNode,
  validateTree,
  validateMinimumThreeLevel,
  detectDuplicates,
};
