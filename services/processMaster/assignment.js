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

function validateAssignment(db, { process_node_id, user_id }) {
  if (!process_node_id || !user_id) throw ApiError.validation("process_node_id / user_id 必填");
  const node = db.prepare(`
    SELECT pn.*, p.position_name, p.skill_category AS position_skill, p.min_level, p.required_cert_type AS position_cert_type,
           pot.sop_required AS template_sop_required, pot.drawing_required AS template_drawing_required
    FROM process_nodes pn
    LEFT JOIN process_positions p ON p.position_code = pn.required_position_code
    LEFT JOIN process_operation_templates pot ON pot.id = pn.operation_template_id
    WHERE pn.id = ?
  `).get(process_node_id);
  if (!node) throw ApiError.notFound("工艺节点不存在");
  const user = db.prepare("SELECT id, full_name, role_code, is_active FROM users WHERE id = ?").get(user_id);
  if (!user || Number(user.is_active) !== 1) throw ApiError.notFound("人员不存在或已停用");

  const skillCategory = node.position_skill || node.required_skill;
  const minLevel = Number(node.min_level || 1);
  const certType = node.position_cert_type || null;
  const skill = skillCategory ? db.prepare(`
    SELECT * FROM worker_skills
    WHERE user_id = ?
      AND (skill_category = ? OR skill_name = ?)
      AND proficiency_level >= ?
    ORDER BY proficiency_level DESC
    LIMIT 1
  `).get(user_id, skillCategory, skillCategory, minLevel) : null;

  const certificate = certType ? db.prepare(`
    SELECT * FROM worker_certificates
    WHERE user_id = ? AND cert_type = ? AND status = 'valid'
      AND (expiry_date IS NULL OR expiry_date >= date('now'))
    ORDER BY expiry_date IS NULL DESC, expiry_date DESC
    LIMIT 1
  `).get(user_id, certType) : null;

  const requiredDocs = db.prepare(`
    SELECT pod.*, d.status AS doc_status, da.id AS acknowledgement_id
    FROM process_operation_docs pod
    LEFT JOIN documents d ON d.id = pod.doc_id
    LEFT JOIN doc_acknowledgements da ON da.doc_id = d.id AND da.ack_by = ?
    WHERE pod.operation_template_id = ?
  `).all(user_id, node.operation_template_id);
  const missingDocs = [];
  const requiredTypes = new Set(requiredDocs.filter((item) => Number(item.is_required) === 1).map((item) => item.doc_type));
  if (Number(node.template_sop_required) === 1 && !requiredTypes.has("sop")) missingDocs.push("工序模板要求 SOP，但尚未绑定必需文档");
  if (Number(node.template_drawing_required) === 1 && !requiredTypes.has("drawing")) missingDocs.push("工序模板要求图纸，但尚未绑定必需文档");
  for (const document of requiredDocs) {
    if (Number(document.is_required) !== 1) continue;
    if (!document.doc_id || document.doc_status !== "issued") {
      missingDocs.push(`${document.title} 未绑定或未签发`);
    } else if (!document.acknowledgement_id) {
      missingDocs.push(`${document.title} 尚未由 ${user.full_name} 签收`);
    }
  }

  const missing = [];
  if (skillCategory && !skill) missing.push(`缺少 ${skillCategory} L${minLevel}+ 技能`);
  if (missingDocs.length > 0) missing.push(...missingDocs);
  if (certType && !certificate) missing.push(`缺少有效 ${certType} 资质证书`);
  return {
    ok: missing.length === 0,
    missing,
    process_node_id: Number(process_node_id),
    user_id: Number(user_id),
    user_name: user.full_name,
    required_position_code: node.required_position_code,
    position_name: node.position_name,
    required_skill: skillCategory,
    min_level: minLevel,
    required_cert_type: certType,
    matched_skill: skill,
    matched_certificate: certificate,
  };
}

module.exports = { applyTemplateToNode, validateAssignment };
