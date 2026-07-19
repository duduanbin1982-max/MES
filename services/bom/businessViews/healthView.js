"use strict";

function computeHealthView(ctx) {
  const {
    db,
    instanceId,
    rowsArg = null,
    validateTree,
    detectDuplicates,
    cleanText,
    normalizeBool,
    normalizeFloat,
    normalizeInt,
    tierSummary,
    SELF_MADE_CATEGORIES,
    PURCHASED_CATEGORIES,
  } = ctx;

  const rows = rowsArg || db.prepare("SELECT * FROM instance_bom WHERE equipment_instance_id = ? ORDER BY tier, id").all(instanceId);
  const validation = validateTree(db, instanceId, rows);
  const duplicates = detectDuplicates(rows);
  const missingMaterialOrPart = rows.filter((r) => Number(r.tier) >= 2 && !r.material_id && !cleanText(r.part_number) && !normalizeBool(r.is_phantom));
  const missingMaterialGrade = rows.filter((r) => SELF_MADE_CATEGORIES.has(r.category) && !cleanText(r.material_grade));
  const missingSurface = rows.filter((r) => SELF_MADE_CATEGORIES.has(r.category) && !cleanText(r.surface_treatment));
  const missingBrand = rows.filter((r) => PURCHASED_CATEGORIES.has(r.category) && !cleanText(r.brand_recommend));
  const missingUnitPrice = rows.filter((r) => Number(r.tier) >= 2 && !normalizeBool(r.is_phantom) && normalizeFloat(r.unit_price, null) === null);
  const missingVersion = rows.filter((r) => !cleanText(r.version));
  const missingOperation = rows.filter((r) => Number(r.tier) >= 1 && Number(r.tier) <= 2 && !normalizeBool(r.is_phantom) && !normalizeInt(r.operation_id, null));
  const alternativeWithoutGroup = rows.filter((r) => normalizeBool(r.is_alternative) && !cleanText(r.alternative_group));
  const materialWarnings = rows.filter((r) => r.material_id && cleanText(r.part_number) && normalizeInt(r.tier, 0) >= 2);

  let unlinkedDocuments = [];
  try {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get()) {
      unlinkedDocuments = rows.filter((r) => {
        const doc = db.prepare("SELECT id FROM documents WHERE bom_node_id = ? LIMIT 1").get(r.id);
        return Number(r.tier) >= 1 && !doc;
      });
    }
  } catch (_e) {
    unlinkedDocuments = [];
  }

  const issues = [
    validation.errors.length * 8,
    duplicates.duplicateMaterialNodes.length * 5,
    duplicates.duplicatePartNumbers.length * 4,
    missingMaterialOrPart.length * 4,
    missingMaterialGrade.length * 3,
    missingSurface.length * 3,
    missingBrand.length * 2,
    missingUnitPrice.length * 2,
    missingOperation.length * 1,
    alternativeWithoutGroup.length * 2,
    unlinkedDocuments.length * 1,
  ].reduce((sum, value) => sum + value, 0);

  const score = Math.max(0, 100 - issues);
  const samples = [];
  if (missingMaterialOrPart[0]) samples.push(`缺物料/图号: #${missingMaterialOrPart[0].id}`);
  if (missingUnitPrice[0]) samples.push(`缺估价: #${missingUnitPrice[0].id}`);
  if (duplicates.duplicateMaterialNodes[0]) samples.push(`重复物料: ${duplicates.duplicateMaterialNodes[0][0]}`);
  if (missingOperation[0]) samples.push(`缺工艺: #${missingOperation[0].id}`);
  if (unlinkedDocuments[0]) samples.push(`缺图纸: #${unlinkedDocuments[0].id}`);

  return {
    score,
    summary: tierSummary(rows),
    total_nodes: rows.length,
    errors_count: validation.errors.length,
    warnings_count: validation.warnings.length,
    checks: {
      duplicate_material_nodes: duplicates.duplicateMaterialNodes.length,
      duplicate_part_numbers: duplicates.duplicatePartNumbers.length,
      missing_material_or_part: missingMaterialOrPart.length,
      missing_material_grade: missingMaterialGrade.length,
      missing_surface_treatment: missingSurface.length,
      missing_brand_recommend: missingBrand.length,
      missing_unit_price: missingUnitPrice.length,
      missing_version: missingVersion.length,
      missing_operation_route: missingOperation.length,
      alternative_without_group: alternativeWithoutGroup.length,
      nodes_without_documents: unlinkedDocuments.length,
      material_and_part_both_filled: materialWarnings.length,
    },
    highlights: samples,
    validation,
  };
}

module.exports = { computeHealthView };
