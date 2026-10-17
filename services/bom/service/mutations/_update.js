"use strict";
// 快模式按主题拆分（原 services/bom/service/mutations.js）
const { ApiError } = require("../../../../app/errors");
const { validateNode, normalizeInt, cleanText } = require("../../core");
const { ensureBomStructureColumns } = require("../schema");
const { buildValidationContext, recomputeStructureMetadata, rowToSafeNode } = require("./_meta");
const { assertNoCycle, deriveTier, getParent, nextSortOrder } = require("./_tree");

function updateBomNode(db, bomId, body) {
  ensureBomStructureColumns(db);
  const current = db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(bomId);
  if (!current) throw ApiError.notFound("BOM 节点不存在: " + bomId);
  const parentId = body && Object.prototype.hasOwnProperty.call(body, "parent_id")
    ? normalizeInt(body.parent_id, null)
    : normalizeInt(current.parent_id, null);
  if (parentId && !getParent(db, current.equipment_instance_id, parentId)) throw ApiError.validation(`父节点不存在: ${parentId}`);
  if (!parentId) {
    const rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL AND id <> ?").get(current.equipment_instance_id, current.id).c || 0;
    if (rootCount > 0) throw ApiError.validation("项目装备结构树只能有一个 0级整机根节点");
  }
  assertNoCycle(db, current.id, parentId);
  const safeNode = rowToSafeNode({
    ...current,
    ...(body || {}),
    parent_id: parentId,
    _tier_derived: deriveTier(db, current.equipment_instance_id, parentId, 0),
    sort_order: normalizeInt((body || {}).sort_order, null) || current.sort_order || nextSortOrder(db, current.equipment_instance_id, parentId),
  }, current.equipment_instance_id, current.created_by || null);
  const ctx = buildValidationContext(db, current.equipment_instance_id, current.id);
  const validation = validateNode(safeNode, ctx);
  if (!validation.ok) throw ApiError.validation("BOM 校验失败", validation.errors);
  db.prepare(`
    UPDATE instance_bom
    SET parent_id=@parent_id, tier=@tier, node_type=@node_type, level_code=@level_code, sort_order=@sort_order, view_flags=@view_flags,
        version=@version, eco_id=@eco_id, effective_from=@effective_from, effective_to=@effective_to,
        material_id=@material_id, part_number=@part_number, quantity=@quantity, unit=@unit, scrap_factor=@scrap_factor, category=@category,
        material_grade=@material_grade, surface_treatment=@surface_treatment, brand_recommend=@brand_recommend, brand_grade=@brand_grade,
        is_alternative=@is_alternative, alternative_group=@alternative_group, alternative_priority=@alternative_priority, operation_id=@operation_id,
        is_phantom=@is_phantom, is_key_component=@is_key_component, is_wear_part=@is_wear_part, storage_location=@storage_location,
        weight=@weight, unit_price=@unit_price, notes=@notes, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...safeNode, id: current.id });
  recomputeStructureMetadata(db, current.equipment_instance_id);
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(current.id);
}

function moveBomNode(db, bomId, body = {}) {
  ensureBomStructureColumns(db);
  const current = db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(bomId);
  if (!current) throw ApiError.notFound("BOM 节点不存在: " + bomId);
  const targetId = normalizeInt(body.target_id, null);
  const dropType = cleanText(body.drop_type) || "inner";
  let parentId = normalizeInt(body.parent_id, null);
  let sortOrder = nextSortOrder(db, current.equipment_instance_id, parentId);

  if (targetId) {
    const target = db.prepare("SELECT * FROM instance_bom WHERE id = ? AND equipment_instance_id = ?").get(targetId, current.equipment_instance_id);
    if (!target) throw ApiError.validation(`目标节点不存在: ${targetId}`);
    if (dropType === "inner") {
      parentId = target.id;
      sortOrder = nextSortOrder(db, current.equipment_instance_id, parentId);
    } else {
      parentId = normalizeInt(target.parent_id, null);
      sortOrder = Number(target.sort_order || 0) + (dropType === "before" ? -1 : 1);
    }
  }
  if (!parentId) {
    const rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL AND id <> ?").get(current.equipment_instance_id, current.id).c || 0;
    if (rootCount > 0) throw ApiError.validation("项目装备结构树只能有一个 0级整机根节点");
  }

  assertNoCycle(db, current.id, parentId);
  const tier = deriveTier(db, current.equipment_instance_id, parentId, 0);
  db.prepare("UPDATE instance_bom SET parent_id = ?, tier = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?").run(parentId, tier, sortOrder, current.id);
  recomputeStructureMetadata(db, current.equipment_instance_id);
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(current.id);
}

function deleteBomNodeCascade(db, bomId) {
  ensureBomStructureColumns(db);
  const id = Number(bomId);
  const exists = db.prepare("SELECT id, equipment_instance_id FROM instance_bom WHERE id = ?").get(id);
  if (!exists) throw ApiError.notFound("BOM 节点不存在: " + id);
  const all = db.prepare("SELECT id, parent_id FROM instance_bom WHERE equipment_instance_id = ?").all(exists.equipment_instance_id);
  const toDelete = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const row of all) {
      if (row.parent_id && toDelete.has(Number(row.parent_id)) && !toDelete.has(Number(row.id))) {
        toDelete.add(Number(row.id));
        added = true;
      }
    }
  }
  const del = db.prepare("DELETE FROM instance_bom WHERE id = ?");
  for (const nodeId of toDelete) del.run(nodeId);
  recomputeStructureMetadata(db, exists.equipment_instance_id);
  return { deleted: [...toDelete], count: toDelete.size };
}

module.exports = { deleteBomNodeCascade, moveBomNode, updateBomNode };
