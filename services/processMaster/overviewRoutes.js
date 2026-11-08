"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { createDbAccess } = require("./utils");

function registerOverviewRoutes(app, db) {
  const { get } = createDbAccess(db);
  app.get("/api/process-master/overview", wrap((_request, response) => {
    const position = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_positions");
    const operation = get("SELECT COUNT(*) total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM process_operation_templates");
    const processNode = get(`
      SELECT COUNT(*) total,
             SUM(CASE WHEN operation_template_id IS NOT NULL THEN 1 ELSE 0 END) templated,
             SUM(CASE WHEN required_position_code IS NOT NULL AND required_position_code != '' THEN 1 ELSE 0 END) positioned,
             SUM(CASE WHEN COALESCE(worker_count, 0) > 0 THEN 1 ELSE 0 END) staffed
      FROM process_nodes
    `);
    response.json({ positions: position, operations: operation, process_nodes: processNode });
  }));

  // 2026-11-08（工序/岗位审计）：配置健康度（未配置节点、缺文档、停用引用、孤儿引用）
  app.get("/api/process-master/health", wrap((_request, response) => {
    const nodes = get(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN operation_template_id IS NULL THEN 1 ELSE 0 END), 0) AS no_template,
             COALESCE(SUM(CASE WHEN required_position_code IS NULL OR required_position_code = '' THEN 1 ELSE 0 END), 0) AS no_position,
             COALESCE(SUM(CASE WHEN operation_template_id IS NULL OR required_position_code IS NULL OR required_position_code = '' THEN 1 ELSE 0 END), 0) AS unconfigured
      FROM process_nodes
    `);
    const templates = get(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN required_position_code IS NULL OR required_position_code = '' THEN 1 ELSE 0 END), 0) AS missing_position,
             COALESCE(SUM(CASE WHEN sop_required = 1 AND NOT EXISTS (
               SELECT 1 FROM process_operation_docs d WHERE d.operation_template_id = t.id AND d.is_required = 1 AND d.doc_type = 'sop'
             ) THEN 1 ELSE 0 END), 0) AS sop_without_doc,
             COALESCE(SUM(CASE WHEN drawing_required = 1 AND NOT EXISTS (
               SELECT 1 FROM process_operation_docs d WHERE d.operation_template_id = t.id AND d.is_required = 1 AND d.doc_type = 'drawing'
             ) THEN 1 ELSE 0 END), 0) AS drawing_without_doc
      FROM process_operation_templates t
    `);
    const documents = get(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN is_required = 1 AND (
               doc_id IS NULL OR doc_id NOT IN (SELECT id FROM documents WHERE status = 'issued')
             ) THEN 1 ELSE 0 END), 0) AS required_unready
      FROM process_operation_docs
    `);
    const inactivePositionRefs = get(`
      SELECT
        (SELECT COUNT(*) FROM process_operation_templates t JOIN process_positions p ON p.position_code = t.required_position_code WHERE p.is_active = 0) +
        (SELECT COUNT(*) FROM process_nodes n JOIN process_positions p ON p.position_code = n.required_position_code WHERE p.is_active = 0) AS c
    `).c;
    const orphan = get(`
      SELECT
        (SELECT COUNT(*) FROM process_nodes n WHERE n.operation_template_id IS NOT NULL AND n.operation_template_id NOT IN (SELECT id FROM process_operation_templates)) +
        (SELECT COUNT(*) FROM process_nodes n WHERE n.required_position_code IS NOT NULL AND n.required_position_code <> '' AND n.required_position_code NOT IN (SELECT position_code FROM process_positions)) AS c
    `).c;
    const issues = [];
    if (Number(nodes.unconfigured) > 0) issues.push({ code: "NODES_UNCONFIGURED", severity: "warning", label: `${nodes.unconfigured} 个工艺节点未配置工序模板或岗位`, count: Number(nodes.unconfigured) });
    if (Number(templates.sop_without_doc) > 0) issues.push({ code: "SOP_WITHOUT_DOC", severity: "error", label: `${templates.sop_without_doc} 个工序模板要求 SOP 但未绑定必需 SOP`, count: Number(templates.sop_without_doc) });
    if (Number(templates.drawing_without_doc) > 0) issues.push({ code: "DRAWING_WITHOUT_DOC", severity: "error", label: `${templates.drawing_without_doc} 个工序模板要求图纸但未绑定必需图纸`, count: Number(templates.drawing_without_doc) });
    if (Number(documents.required_unready) > 0) issues.push({ code: "DOCS_UNREADY", severity: "error", label: `${documents.required_unready} 个必需文档未绑定或未签发`, count: Number(documents.required_unready) });
    if (Number(inactivePositionRefs) > 0) issues.push({ code: "INACTIVE_POSITION_REFS", severity: "warning", label: `${inactivePositionRefs} 处仍引用已停用岗位`, count: Number(inactivePositionRefs) });
    if (Number(orphan) > 0) issues.push({ code: "ORPHAN_REFS", severity: "error", label: `${orphan} 处工序/岗位引用已失效`, count: Number(orphan) });
    response.json({ nodes, templates, documents, inactive_position_refs: Number(inactivePositionRefs), orphan_refs: Number(orphan), issues });
  }));
}

module.exports = { registerOverviewRoutes };
