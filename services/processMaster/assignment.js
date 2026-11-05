"use strict";

const { ApiError } = require("../../app/errors");

function findWorkstation(db, stationType) {
  if (!stationType) return null;
  const row = db.prepare(`
    SELECT id FROM workstations
    WHERE is_active = 1 AND status != 'disabled'
      AND (station_type = ? OR name LIKE ? OR workshop LIKE ?)
    ORDER BY CASE status WHEN 'available' THEN 1 ELSE 2 END, id
    LIMIT 1
  `).get(stationType, `%${stationType}%`, `%${stationType}%`);
  return row ? row.id : null;
}

function applyTemplateToNode(db, nodeId, templateId) {
  const template = db.prepare("SELECT * FROM process_operation_templates WHERE id = ? AND is_active = 1").get(templateId);
  if (!template) throw ApiError.notFound("工序模板不存在或已停用");
  const workstationId = findWorkstation(db, template.default_station_type);
  const result = db.prepare(`
    UPDATE process_nodes
    SET operation_template_id = ?,
        operation_name = ?,
        operation_type = ?,
        estimated_hours = ?,
        required_workstation_id = COALESCE(required_workstation_id, ?),
        required_skill = ?,
        required_position_code = ?,
        worker_count = ?,
        qc_required = ?,
        sop_required = ?,
        drawing_required = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    template.id,
    template.operation_name,
    template.operation_type,
    template.standard_hours,
    workstationId,
    template.required_skill,
    template.required_position_code,
    template.worker_count,
    template.qc_required,
    template.sop_required,
    template.drawing_required,
    nodeId,
  );
  if (!result.changes) throw ApiError.notFound("工艺节点不存在");
  return { template, workstation_id: workstationId, changes: result.changes };
}

// 2026-11-05（审计 F-06）：资质校验已抽到 shared/assignmentValidation，process 与 schedule 共用。
const { validateAssignment } = require("../../shared/assignmentValidation");

module.exports = { applyTemplateToNode, validateAssignment };
