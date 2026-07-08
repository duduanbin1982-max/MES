"use strict";

const { ApiError } = require("../../../app/errors");
const {
  validateNode,
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
} = require("../core");

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

function rowToSafeNode(node, instanceId, userId = null) {
  return {
    equipment_instance_id: normalizeInt(instanceId, null),
    parent_id: normalizeInt(node.parent_id, null),
    tier: normalizeInt(node.tier, 2),
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

function createMinimumBomSkeleton(db, instanceId) {
  const inst = db.prepare("SELECT id, instance_code, instance_name, name FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!inst) throw ApiError.notFound("装备实例不存在");
  const existing = db.prepare("SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?").get(instanceId).c;
  if (existing > 0) throw ApiError.validation("该实例已有 BOM, 不允许覆盖生成骨架");
  const tx = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO instance_bom (
        equipment_instance_id, parent_id, tier, version, part_number, quantity, unit, category, is_phantom, notes
      ) VALUES (?, ?, ?, 'A0', ?, ?, ?, ?, ?, ?)
    `);
    const code = inst.instance_code || `INST-${inst.id}`;
    const title = inst.instance_name || inst.name || "整机总装";
    const root = insert.run(instanceId, null, 0, code, 1, "台", "成品", 0, title).lastInsertRowid;
    const moduleA = insert.run(instanceId, root, 1, `${code}-01`, 1, "套", "自制部件", 0, "1级部件示例: 刀盘组件").lastInsertRowid;
    const moduleB = insert.run(instanceId, root, 1, `${code}-02`, 1, "套", "自制部件", 0, "1级部件示例: 主机架组件").lastInsertRowid;
    insert.run(instanceId, moduleA, 2, `${code}-01-001`, 1, "件", "自制机加件", 0, "2级零件示例: 待替换");
    insert.run(instanceId, moduleB, 2, `${code}-02-001`, 1, "件", "自制钣金件", 0, "2级零件示例: 待替换");
    return { root, components: [moduleA, moduleB] };
  });
  return tx();
}

function resolveMaterialId(db, row) {
  if (row.material_id) return normalizeInt(row.material_id, null);
  const materialCode = cleanText(row.material_code);
  if (!materialCode) return null;
  const hit = db.prepare("SELECT id FROM materials WHERE material_code = ?").get(materialCode);
  return hit ? Number(hit.id) : null;
}

function insertBomNode(db, instanceId, body, userId = null) {
  const safeNode = rowToSafeNode(body || {}, instanceId, userId);
  const ctx = buildValidationContext(db, instanceId);
  const validation = validateNode(safeNode, ctx);
  if (!validation.ok) throw ApiError.validation("BOM 校验失败", validation.errors);
  const stmt = db.prepare(`
    INSERT INTO instance_bom (
      equipment_instance_id, parent_id, tier, version, eco_id, effective_from, effective_to,
      material_id, part_number, quantity, unit, scrap_factor, category, material_grade,
      surface_treatment, brand_recommend, brand_grade, is_alternative, alternative_group,
      alternative_priority, operation_id, is_phantom, is_key_component, is_wear_part,
      storage_location, weight, unit_price, notes, created_by
    ) VALUES (
      @equipment_instance_id, @parent_id, @tier, @version, @eco_id, @effective_from, @effective_to,
      @material_id, @part_number, @quantity, @unit, @scrap_factor, @category, @material_grade,
      @surface_treatment, @brand_recommend, @brand_grade, @is_alternative, @alternative_group,
      @alternative_priority, @operation_id, @is_phantom, @is_key_component, @is_wear_part,
      @storage_location, @weight, @unit_price, @notes, @created_by
    )
  `);
  const result = stmt.run(safeNode);
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(result.lastInsertRowid);
}

function updateBomNode(db, bomId, body) {
  const current = db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(bomId);
  if (!current) throw ApiError.notFound("BOM 节点不存在: " + bomId);
  const safeNode = rowToSafeNode({ ...current, ...(body || {}) }, current.equipment_instance_id, current.created_by || null);
  const ctx = buildValidationContext(db, current.equipment_instance_id, current.id);
  const validation = validateNode(safeNode, ctx);
  if (!validation.ok) throw ApiError.validation("BOM 校验失败", validation.errors);
  db.prepare(`
    UPDATE instance_bom
    SET parent_id=@parent_id, tier=@tier, version=@version, eco_id=@eco_id, effective_from=@effective_from, effective_to=@effective_to,
        material_id=@material_id, part_number=@part_number, quantity=@quantity, unit=@unit, scrap_factor=@scrap_factor, category=@category,
        material_grade=@material_grade, surface_treatment=@surface_treatment, brand_recommend=@brand_recommend, brand_grade=@brand_grade,
        is_alternative=@is_alternative, alternative_group=@alternative_group, alternative_priority=@alternative_priority, operation_id=@operation_id,
        is_phantom=@is_phantom, is_key_component=@is_key_component, is_wear_part=@is_wear_part, storage_location=@storage_location,
        weight=@weight, unit_price=@unit_price, notes=@notes, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...safeNode, id: current.id });
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(current.id);
}

function deleteBomNodeCascade(db, bomId) {
  const id = Number(bomId);
  const exists = db.prepare("SELECT id FROM instance_bom WHERE id = ?").get(id);
  if (!exists) throw ApiError.notFound("BOM 节点不存在: " + id);
  const all = db.prepare("SELECT id, parent_id FROM instance_bom").all();
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
  return { deleted: [...toDelete], count: toDelete.size };
}

module.exports = {
  buildValidationContext,
  rowToSafeNode,
  createMinimumBomSkeleton,
  resolveMaterialId,
  insertBomNode,
  updateBomNode,
  deleteBomNodeCascade,
};
