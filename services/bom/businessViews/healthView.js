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
  // 2026-11-07（BOM 健康分升级）：结构化问题清单、根节点状态、等级与发布门禁
  const rootRows = rows.filter((r) => Number(r.tier) === 0 && (r.parent_id === null || Number(r.parent_id) === 0));
  const rootState = rows.length === 0 ? "empty" : rootRows.length === 0 ? "missing" : rootRows.length > 1 ? "multiple" : "single";
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  const issueList = [];
  validation.errors.forEach((message) => issueList.push({ severity: "error", code: "STRUCTURE", message, fixable: /根节点|父节点|孤儿|层级/.test(message) }));
  validation.warnings.forEach((message) => issueList.push({ severity: "warning", code: "STRUCTURE_WARN", message, fixable: false }));
  const checks = {
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
  };
  const checkLabels = {
    duplicate_material_nodes: ["重复物料", "warning"],
    duplicate_part_numbers: ["重复图号", "warning"],
    missing_material_or_part: ["缺物料/图号", "error"],
    missing_material_grade: ["缺材质", "warning"],
    missing_surface_treatment: ["缺表面处理", "warning"],
    missing_brand_recommend: ["缺品牌建议", "info"],
    missing_unit_price: ["缺单价", "warning"],
    missing_version: ["缺版本", "info"],
    missing_operation_route: ["缺工艺路线", "warning"],
    alternative_without_group: ["替代料缺替代组", "warning"],
    nodes_without_documents: ["节点无图纸", "info"],
    material_and_part_both_filled: ["物料/图号同时填写", "info"],
  };
  for (const [code, [label, severity]] of Object.entries(checkLabels)) {
    const count = Number(checks[code] || 0);
    if (count > 0) issueList.push({ severity, code, message: `${label} ${count} 项`, count, fixable: false });
  }
  const minScore = Number(process.env.BOM_RELEASE_MIN_SCORE || 70);
  const blockers = [];
  if (validation.errors.length) blockers.push(...validation.errors.slice(0, 10).map((message) => "结构错误：" + message));
  if (score < minScore) blockers.push(`BOM 健康分 ${score} 低于发布门槛 ${minScore}`);
  const releaseGate = { min_score: minScore, score, can_release: validation.ok && score >= minScore, blockers: blockers.slice(0, 20) };

  const samples = [];
  if (missingMaterialOrPart[0]) samples.push(`缺物料/图号: #${missingMaterialOrPart[0].id}`);
  if (missingUnitPrice[0]) samples.push(`缺估价: #${missingUnitPrice[0].id}`);
  if (duplicates.duplicateMaterialNodes[0]) samples.push(`重复物料: ${duplicates.duplicateMaterialNodes[0][0]}`);
  if (missingOperation[0]) samples.push(`缺工艺: #${missingOperation[0].id}`);
  if (unlinkedDocuments[0]) samples.push(`缺图纸: #${unlinkedDocuments[0].id}`);

  return {
    score,
    grade,
    root_state: rootState,
    root_count: rootRows.length,
    empty: rows.length === 0,
    issues: issueList.slice(0, 300),
    release_gate: releaseGate,
    summary: tierSummary(rows),
    total_nodes: rows.length,
    errors_count: validation.errors.length,
    warnings_count: validation.warnings.length,
    checks,
    highlights: samples,
    validation,
  };
}

module.exports = { computeHealthView };
