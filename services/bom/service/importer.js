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
    const materialId = resolveMaterialId(db, row);
    const safeNode = rowToSafeNode({
      ...row,
      parent_id: parentId,
      material_id: materialId,
      version: cleanText(row.version) || "A0",
    }, instanceId, userId);
    const ctx = buildValidationContext(db, instanceId);
    const validation = validateNode(safeNode, { ...ctx, allowParentless: safeNode.tier === 0 });

    if (parentRef && !refMap.has(parentRef)) validation.errors.push(`parent_ref 未找到已导入节点: ${parentRef}`);
    if (!validation.ok) {
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
    template_version: template.version,
    health: computeHealth(db, instanceId),
  };
}

module.exports = {
  importBomCsv,
};
