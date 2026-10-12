"use strict";
// 快模式按主题拆分（原 services/bom/service/mutations.js）
const {
  validateNode,
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
} = require("../../core");
const { tableColumns, ensureBomStructureColumns } = require("../schema");
const { inferNodeType } = require("./_tree");

function buildValidationContext(db, instanceId, excludeId = null) {
  const rows = db.prepare(`
    SELECT id, parent_id, tier
    FROM instance_bom
    WHERE equipment_instance_id = ?
      ${excludeId ? "AND id <> ?" : ""}
  `).all(...(excludeId ? [instanceId, excludeId] : [instanceId]));
  const materialIds = new Set((db.prepare("SELECT id FROM materials").all() || []).map((material) => Number(material.id)));
  return {
    parentById: new Map(rows.map((row) => [Number(row.id), row])),
    materialIds,
  };
}

function recomputeStructureMetadata(db, instanceId) {
  ensureBomStructureColumns(db);
  const rows = db.prepare("SELECT id, parent_id, tier, sort_order FROM instance_bom WHERE equipment_instance_id = ? ORDER BY COALESCE(sort_order, 0), id").all(instanceId);
  const children = new Map();
  for (const row of rows) {
    const parentId = normalizeInt(row.parent_id, null) || 0;
    const arr = children.get(parentId) || [];
    arr.push(row);
    children.set(parentId, arr);
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
  }
  const update = db.prepare("UPDATE instance_bom SET tier = ?, level_code = ?, sort_order = ? WHERE id = ?");
  function walk(parentKey, parentCode, depth) {
    const arr = children.get(parentKey) || [];
    arr.forEach((row, index) => {
      const sortOrder = (index + 1) * 10;
      const segment = parentKey === 0 ? (depth === 0 ? "0" : String(index + 1).padStart(2, "0")) : String(index + 1).padStart(2, "0");
      const levelCode = parentKey === 0 ? segment : `${parentCode}-${segment}`;
      update.run(depth, levelCode, sortOrder, row.id);
      walk(Number(row.id), levelCode, depth + 1);
    });
  }
  walk(0, "", 0);
}

function rowToSafeNode(node, instanceId, userId = null) {
  const parentId = normalizeInt(node.parent_id, null);
  const tier = node._tier_derived != null ? normalizeInt(node._tier_derived, 0) : normalizeInt(node.tier, parentId ? 1 : 0);
  return {
    equipment_instance_id: normalizeInt(instanceId, null),
    parent_id: parentId,
    tier,
    node_type: inferNodeType({ ...node, tier }),
    level_code: cleanText(node.level_code),
    sort_order: normalizeInt(node.sort_order, 0),
    view_flags: cleanText(node.view_flags),
    version: cleanText(node.version) || "A0",
    eco_id: normalizeInt(node.eco_id, null),
    effective_from: cleanText(node.effective_from),
    effective_to: cleanText(node.effective_to),
    material_id: normalizeInt(node.material_id, null),
    part_number: cleanText(node.part_number),
    quantity: normalizeFloat(node.quantity, 1),
    unit: cleanText(node.unit) || "件",
    scrap_factor: normalizeFloat(node.scrap_factor, 1),
    category: cleanText(node.category),
    material_grade: cleanText(node.material_grade),
    surface_treatment: cleanText(node.surface_treatment),
    brand_recommend: cleanText(node.brand_recommend),
    brand_grade: cleanText(node.brand_grade),
    is_alternative: normalizeBool(node.is_alternative),
    alternative_group: cleanText(node.alternative_group),
    alternative_priority: normalizeInt(node.alternative_priority, 1),
    operation_id: normalizeInt(node.operation_id, null),
    is_phantom: normalizeBool(node.is_phantom),
    is_key_component: normalizeBool(node.is_key_component),
    is_wear_part: normalizeBool(node.is_wear_part),
    storage_location: cleanText(node.storage_location),
    weight: normalizeFloat(node.weight, null),
    unit_price: normalizeFloat(node.unit_price, null),
    notes: cleanText(node.notes),
    created_by: userId,
  };
}

function resolveMaterialId(db, row) {
  if (row.material_id) return normalizeInt(row.material_id, null);
  const materialCode = cleanText(row.material_code);
  if (!materialCode) return null;
  const hit = db.prepare("SELECT id FROM materials WHERE material_code = ?").get(materialCode);
  return hit ? Number(hit.id) : null;
}

module.exports = { buildValidationContext, recomputeStructureMetadata, resolveMaterialId, rowToSafeNode };
