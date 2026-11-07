"use strict";
// 快模式按主题拆分（原 services/bom/service/mutations.js）
const { ApiError } = require("../../../../app/errors");
const { validateNode, normalizeInt } = require("../../core");
const { ensureBomStructureColumns } = require("../schema");
const { buildValidationContext, recomputeStructureMetadata, rowToSafeNode } = require("./_meta");
const { deriveTier, nextSortOrder } = require("./_tree");

function createMinimumBomSkeleton(db, instanceId) {
  ensureBomStructureColumns(db);
  const inst = db.prepare("SELECT id, instance_code, instance_name, name FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!inst) throw ApiError.notFound("项目装备不存在");
  const existing = db.prepare("SELECT COUNT(*) c FROM instance_bom WHERE equipment_instance_id = ?").get(instanceId).c;
  if (existing > 0) throw ApiError.validation("该实例已有 BOM, 不允许覆盖生成骨架");
  const tx = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO instance_bom (
        equipment_instance_id, parent_id, tier, node_type, level_code, sort_order, version, part_number, quantity, unit, category, is_phantom, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'A0', ?, ?, ?, ?, ?, ?)
    `);
    const code = inst.instance_code || `INST-${inst.id}`;
    const title = inst.instance_name || inst.name || "整机总装";
    const root = insert.run(instanceId, null, 0, "equipment", "0", 10, code, 1, "台", "成品", 0, title).lastInsertRowid;
    const moduleA = insert.run(instanceId, root, 1, "system", "01", 10, `${code}-01`, 1, "套", "自制部件", 0, "1级部件示例: 刀盘组件").lastInsertRowid;
    const moduleB = insert.run(instanceId, root, 1, "system", "02", 20, `${code}-02`, 1, "套", "自制部件", 0, "1级部件示例: 主机架组件").lastInsertRowid;
    insert.run(instanceId, moduleA, 2, "self_made", "01-01", 10, `${code}-01-001`, 1, "件", "自制机加件", 0, "2级零件示例: 待替换");
    insert.run(instanceId, moduleB, 2, "self_made", "02-01", 10, `${code}-02-001`, 1, "件", "自制钣金件", 0, "2级零件示例: 待替换");
    recomputeStructureMetadata(db, instanceId);
    return { root, components: [moduleA, moduleB] };
  });
  return tx();
}

function insertBomNode(db, instanceId, body, userId = null) {
  ensureBomStructureColumns(db);
  const numericInstanceId = normalizeInt(instanceId, null);
  if (!numericInstanceId) throw ApiError.notFound("项目装备不存在: " + instanceId);
  const instance = db.prepare("SELECT id FROM equipment_instances WHERE id = ?").get(numericInstanceId);
  if (!instance) throw ApiError.notFound("项目装备不存在: " + instanceId);
  const bomType = String((body || {}).bom_type || "EBOM").toUpperCase();
  if (!["EBOM", "MBOM"].includes(bomType)) throw ApiError.validation("bom_type 必须是 EBOM 或 MBOM");
  const parentId = normalizeInt((body || {}).parent_id, null);
  if (parentId) {
    const parent = db.prepare("SELECT id, bom_type FROM instance_bom WHERE id = ? AND equipment_instance_id = ?").get(parentId, instanceId);
    if (!parent) throw ApiError.validation(`父节点不存在: ${parentId}`);
    if (String(parent.bom_type || "EBOM") !== bomType) throw ApiError.validation("父节点不属于同一 BOM 类型");
  }
  if (!parentId) {
    let rootCount;
    try { rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL AND COALESCE(bom_type,'EBOM') = ?").get(instanceId, bomType).c || 0; }
    catch (_error) { rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL").get(instanceId).c || 0; }
    if (rootCount > 0) throw ApiError.validation(`该项目 ${bomType} 结构树只能有一个 0级整机根节点，请在根节点下新增主要部件`);
  }
  const safeNode = rowToSafeNode({
    ...(body || {}),
    bom_type: bomType,
    parent_id: parentId,
    _tier_derived: deriveTier(db, instanceId, parentId, 0),
    sort_order: normalizeInt((body || {}).sort_order, null) || nextSortOrder(db, instanceId, parentId),
  }, instanceId, userId);
  const ctx = buildValidationContext(db, instanceId, null, bomType);
  const validation = validateNode(safeNode, ctx);
  if (!validation.ok) throw ApiError.validation("BOM 校验失败", validation.errors);
  const stmt = db.prepare(`
    INSERT INTO instance_bom (
      equipment_instance_id, parent_id, tier, node_type, level_code, sort_order, view_flags, version, eco_id, effective_from, effective_to,
      bom_type, source_bom_id,
      material_id, part_number, quantity, unit, scrap_factor, category, material_grade,
      surface_treatment, brand_recommend, brand_grade, is_alternative, alternative_group,
      alternative_priority, operation_id, is_phantom, is_key_component, is_wear_part,
      storage_location, weight, unit_price, labor_cost, manufacturing_cost, notes, created_by
    ) VALUES (
      @equipment_instance_id, @parent_id, @tier, @node_type, @level_code, @sort_order, @view_flags, @version, @eco_id, @effective_from, @effective_to,
      @bom_type, @source_bom_id,
      @material_id, @part_number, @quantity, @unit, @scrap_factor, @category, @material_grade,
      @surface_treatment, @brand_recommend, @brand_grade, @is_alternative, @alternative_group,
      @alternative_priority, @operation_id, @is_phantom, @is_key_component, @is_wear_part,
      @storage_location, @weight, @unit_price, @labor_cost, @manufacturing_cost, @notes, @created_by
    )
  `);
  const result = stmt.run(safeNode);
  recomputeStructureMetadata(db, instanceId);
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(result.lastInsertRowid);
}

module.exports = { createMinimumBomSkeleton, insertBomNode };
