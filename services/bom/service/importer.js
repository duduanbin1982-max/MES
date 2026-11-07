"use strict";

const { ApiError } = require("../../../app/errors");
const { validateNode, computeHealth, parseCsv, normalizeInt, cleanText } = require("../core");
const { getImportTemplate } = require("./importTemplate");
const { buildValidationContext, resolveMaterialId, rowToSafeNode, recomputeStructureMetadata } = require("./mutations");
const { ensureBomStructureColumns } = require("./schema");

function createInsertStatement(db) {
  return db.prepare(`
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
}

// 2026-11-07（BOM 审计 B-8）：CSV 中 material_code 未匹配时自动创建物料主数据
function resolveOrCreateMaterial(db, row, options) {
  const materialId = resolveMaterialId(db, row);
  if (materialId) return { materialId, created: false };
  const code = cleanText(row.material_code);
  if (!code) return { materialId: null, created: false };
  const allowed = options.create_missing_materials !== false && options.create_missing_materials !== "false";
  if (!allowed) return { materialId: null, created: false, missing: code };
  const name = cleanText(row.material_name) || code;
  const unit = cleanText(row.unit) || "件";
  const price = Number(row.unit_price) || 0;
  try {
    const result = db.prepare(`
      INSERT INTO materials (material_code, material_name, material_type, spec, unit, safety_stock, reorder_point, estimated_unit_price, actual_unit_price)
      VALUES (?, ?, 'BOM导入', ?, ?, 0, 0, ?, ?)
    `).run(code, name, cleanText(row.material_grade) || null, unit, price, price);
    return { materialId: Number(result.lastInsertRowid), created: true };
  } catch (error) {
    return { materialId: null, created: false, missing: code, error: error.message };
  }
}

function importBomCsv(db, instanceId, csv, userId = null, options = {}) {
  ensureBomStructureColumns(db);
  if (!csv) throw ApiError.validation("csv 必填");
  const instance = db.prepare("SELECT id FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!instance) throw ApiError.notFound("项目装备不存在: " + instanceId);
  const { headers, rows } = parseCsv(csv);
  const required = ["tier", "quantity", "unit", "category"];
  for (const field of required) {
    if (!headers.includes(field)) throw ApiError.validation("CSV 缺必填列: " + field);
  }

  const template = getImportTemplate();
  const refMap = new Map();
  const errorList = [];
  const materialsCreated = [];
  let inserted = 0;
  const insertStmt = createInsertStatement(db);
  const allowPartial = options.allow_partial === true || options.allow_partial === "true" || options.allow_partial === 1;

  // 2026-11-07（BOM 审计）：默认原子导入——任一行校验失败则整批回滚，
  // 避免"一半 BOM 已入库"的脏结构；allow_partial=true 时保留逐行导入行为。
  const tx = db.transaction(() => {
  for (const row of rows) {
    const parentRef = cleanText(row.parent_ref);
    const nodeRef = cleanText(row.node_ref);
    const parentId = parentRef ? refMap.get(parentRef) : normalizeInt(row.parent_id, null);
    const material = resolveOrCreateMaterial(db, row, options);
    const materialId = material.materialId;
    if (material.created) materialsCreated.push(cleanText(row.material_code));
    if (material.missing) {
      errorList.push({ line: row.__line, ref: nodeRef, errors: [`物料不存在且未自动创建: ${material.missing}${material.error ? " (" + material.error + ")" : ""}`] });
      continue;
    }
    const bomType = String(options.bom_type || options.bomType || "EBOM").toUpperCase();
    const safeNode = rowToSafeNode({
      ...row,
      bom_type: bomType,
      parent_id: parentId,
      material_id: materialId,
      version: cleanText(row.version) || "A0",
    }, instanceId, userId);
    const ctx = buildValidationContext(db, instanceId, null, bomType);
    const validation = validateNode(safeNode, { ...ctx, allowParentless: safeNode.tier === 0 });
    // 2026-11-07（BOM 审计）：导入同样遵守"单根"约束
    if (safeNode.tier === 0) {
      const rootCount = db.prepare("SELECT COUNT(*) AS c FROM instance_bom WHERE equipment_instance_id = ? AND parent_id IS NULL AND COALESCE(bom_type,'EBOM') = ?").get(instanceId, safeNode.bom_type || 'EBOM').c;
      if (rootCount > 0) validation.errors.push("已存在 0 级根节点，不能重复导入根节点");
    }

    if (parentRef && !refMap.has(parentRef)) validation.errors.push(`parent_ref 未找到已导入节点: ${parentRef}`);
    // validation.ok 在 validateNode 返回时已固化；后续追加的错误必须按 errors.length 判断
    if (!validation.ok || validation.errors.length) {
      errorList.push({ line: row.__line, ref: nodeRef, errors: validation.errors });
      continue;
    }

    try {
      const result = insertStmt.run(safeNode);
      inserted += 1;
      if (nodeRef) refMap.set(nodeRef, Number(result.lastInsertRowid));
    } catch (error) {
      errorList.push({ line: row.__line, ref: nodeRef, errors: [error.message] });
    }
  }
  if (errorList.length && !allowPartial) {
    const validationError = ApiError.validation(`导入校验失败（${errorList.length}/${rows.length} 行），已全部回滚`, {
      total: rows.length,
      error_list: errorList.slice(0, 30),
    });
    validationError.aborted = true;
    throw validationError;
  }
  });
  tx();
  recomputeStructureMetadata(db, instanceId);

  return {
    inserted,
    errors: errorList.length,
    total: rows.length,
    error_list: errorList.slice(0, 30),
    materials_created: materialsCreated.length,
    materials_created_codes: materialsCreated.slice(0, 50),
    template_version: template.version,
    health: computeHealth(db, instanceId, selectRowsForType(db, instanceId, options.bom_type || 'EBOM')),
  };
}

function selectRowsForType(db, instanceId, bomType) {
  try { return db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? AND COALESCE(bom_type,'EBOM') = ? ORDER BY tier, id").all(instanceId, bomType); }
  catch (_error) { return db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId); }
}

module.exports = {
  importBomCsv,
};
