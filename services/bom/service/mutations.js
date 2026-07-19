"use strict";

const { ApiError } = require("../../../app/errors");
const {
  validateNode,
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
} = require("../core");
const { tableColumns, ensureBomStructureColumns } = require("./schema");

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

function inferNodeType(node) {
  const explicit = cleanText(node.node_type);
  if (explicit) return explicit;
  const tier = normalizeInt(node.tier, 2);
  const category = cleanText(node.category);
  if (tier === 0 || category === "成品") return "equipment";
  if (normalizeBool(node.is_phantom) || category === "虚拟件") return "virtual";
  if (category === "自制部件") return tier === 1 ? "system" : "assembly";
  if (category === "自制机加件" || category === "自制钣金件") return "self_made";
  if (category === "标准紧固件") return "standard";
  if (category === "原材料") return "raw_material";
  if (category === "辅助材料") return "consumable";
  if (category === "外购成品" || category === "气动元件" || category === "电气元件" || category === "外协件") return "purchased";
  if (tier === 1) return "system";
  if (tier === 2) return "assembly";
  return "component";
}

function getParent(db, instanceId, parentId) {
  if (!parentId) return null;
  return db.prepare("SELECT id, tier FROM instance_bom WHERE id = ? AND equipment_instance_id = ?").get(parentId, instanceId) || null;
}

function deriveTier(db, instanceId, parentId, fallback = 0) {
  const parent = getParent(db, instanceId, parentId);
  if (parent) return Number(parent.tier || 0) + 1;
  return normalizeInt(fallback, 0);
}

function nextSortOrder(db, instanceId, parentId) {
  const row = parentId
    ? db.prepare("SELECT MAX(COALESCE(sort_order, 0)) AS max_sort FROM instance_bom WHERE equipment_instance_id = ? AND parent_id = ?").get(instanceId, parentId)
    : db.prepare("SELECT MAX(COALESCE(sort_order, 0)) AS max_sort FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL").get(instanceId);
  return Number(row?.max_sort || 0) + 10;
}

function isDescendant(db, candidateId, ancestorId) {
  const rows = db.prepare("SELECT id, parent_id FROM instance_bom").all();
  const children = new Map();
  for (const row of rows) {
    const parentId = normalizeInt(row.parent_id, null);
    if (!parentId) continue;
    const arr = children.get(parentId) || [];
    arr.push(Number(row.id));
    children.set(parentId, arr);
  }
  const stack = [...(children.get(Number(ancestorId)) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (Number(id) === Number(candidateId)) return true;
    stack.push(...(children.get(Number(id)) || []));
  }
  return false;
}

function assertNoCycle(db, nodeId, parentId) {
  if (!parentId) return;
  if (Number(nodeId) === Number(parentId)) throw ApiError.validation("parent_id 不能等于自身 id");
  if (isDescendant(db, parentId, nodeId)) throw ApiError.validation("不能把节点移动到自己的子孙节点下");
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

function resolveMaterialId(db, row) {
  if (row.material_id) return normalizeInt(row.material_id, null);
  const materialCode = cleanText(row.material_code);
  if (!materialCode) return null;
  const hit = db.prepare("SELECT id FROM materials WHERE material_code = ?").get(materialCode);
  return hit ? Number(hit.id) : null;
}

function insertBomNode(db, instanceId, body, userId = null) {
  ensureBomStructureColumns(db);
  const parentId = normalizeInt((body || {}).parent_id, null);
  if (parentId && !getParent(db, instanceId, parentId)) throw ApiError.validation(`父节点不存在: ${parentId}`);
  if (!parentId) {
    const rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL").get(instanceId).c || 0;
    if (rootCount > 0) throw ApiError.validation("项目装备结构树只能有一个 0级整机根节点，请在根节点下新增主要部件");
  }
  const safeNode = rowToSafeNode({
    ...(body || {}),
    parent_id: parentId,
    _tier_derived: deriveTier(db, instanceId, parentId, 0),
    sort_order: normalizeInt((body || {}).sort_order, null) || nextSortOrder(db, instanceId, parentId),
  }, instanceId, userId);
  const ctx = buildValidationContext(db, instanceId);
  const validation = validateNode(safeNode, ctx);
  if (!validation.ok) throw ApiError.validation("BOM 校验失败", validation.errors);
  const stmt = db.prepare(`
    INSERT INTO instance_bom (
      equipment_instance_id, parent_id, tier, node_type, level_code, sort_order, view_flags, version, eco_id, effective_from, effective_to,
      material_id, part_number, quantity, unit, scrap_factor, category, material_grade,
      surface_treatment, brand_recommend, brand_grade, is_alternative, alternative_group,
      alternative_priority, operation_id, is_phantom, is_key_component, is_wear_part,
      storage_location, weight, unit_price, notes, created_by
    ) VALUES (
      @equipment_instance_id, @parent_id, @tier, @node_type, @level_code, @sort_order, @view_flags, @version, @eco_id, @effective_from, @effective_to,
      @material_id, @part_number, @quantity, @unit, @scrap_factor, @category, @material_grade,
      @surface_treatment, @brand_recommend, @brand_grade, @is_alternative, @alternative_group,
      @alternative_priority, @operation_id, @is_phantom, @is_key_component, @is_wear_part,
      @storage_location, @weight, @unit_price, @notes, @created_by
    )
  `);
  const result = stmt.run(safeNode);
  recomputeStructureMetadata(db, instanceId);
  return db.prepare("SELECT * FROM instance_bom WHERE id = ?").get(result.lastInsertRowid);
}

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

module.exports = {
  buildValidationContext,
  rowToSafeNode,
  recomputeStructureMetadata,
  createMinimumBomSkeleton,
  resolveMaterialId,
  insertBomNode,
  updateBomNode,
  moveBomNode,
  deleteBomNodeCascade,
};
