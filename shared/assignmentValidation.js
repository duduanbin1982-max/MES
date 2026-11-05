"use strict";
// shared/assignmentValidation.js
// 2026-11-05（项目排程审计 F-06）：派工资质校验抽成公共模块。
//
// 原先只有「工艺树 → 工序派工」(services/process/node/nodeActions.js) 走 validateAssignment，
// 而 /schedule 的派工接口只校验用户/工位是否有效 —— 计划员可以给没有对应技能/证书/文档签收的人派工。
// 抽到 shared/ 后，两个入口共用同一套校验（技能等级、资质证书、必需文档签收）。
//
// 依赖表：process_nodes / process_positions / process_operation_templates /
//         worker_skills / worker_certificates / process_operation_docs / documents / doc_acknowledgements

const { ApiError } = require("../app/errors");

/** 表是否存在（测试库/精简部署里可能缺可选表，缺表时跳过对应校验而不是直接报错） */
function hasTable(db, name) {
  try {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  } catch (_error) {
    return false;
  }
}

/** 某张表的列名集合（缺表返回空集） */
function columnsOf(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  } catch (_error) {
    return new Set();
  }
}

function validateAssignment(db, { process_node_id, user_id }) {
  if (!process_node_id || !user_id) throw ApiError.validation("process_node_id / user_id 必填");
  const hasPositions = hasTable(db, "process_positions");
  const hasTemplates = hasTable(db, "process_operation_templates");
  const node = db.prepare(`
    SELECT pn.*
           ${hasPositions ? ", p.position_name, p.skill_category AS position_skill, p.min_level, p.required_cert_type AS position_cert_type" : ", NULL AS position_name, NULL AS position_skill, NULL AS min_level, NULL AS position_cert_type"}
           ${hasTemplates ? ", pot.sop_required AS template_sop_required, pot.drawing_required AS template_drawing_required" : ", NULL AS template_sop_required, NULL AS template_drawing_required"}
    FROM process_nodes pn
    ${hasPositions ? "LEFT JOIN process_positions p ON p.position_code = pn.required_position_code" : ""}
    ${hasTemplates ? "LEFT JOIN process_operation_templates pot ON pot.id = pn.operation_template_id" : ""}
    WHERE pn.id = ?
  `).get(process_node_id);
  if (!node) throw ApiError.notFound("工艺节点不存在");
  const userColumns = columnsOf(db, "users");
  const userSelect = ["id", "full_name", "role_code", "is_active"].filter((column) => userColumns.has(column));
  const user = db.prepare(`SELECT ${userSelect.join(", ") || "id"} FROM users WHERE id = ?`).get(user_id);
  if (!user) throw ApiError.notFound("人员不存在或已停用");
  if (userColumns.has("is_active") && Number(user.is_active) !== 1) throw ApiError.notFound("人员不存在或已停用");

  const skillCategory = node.position_skill || node.required_skill;
  const minLevel = Number(node.min_level || 1);
  const certType = node.position_cert_type || null;
  const hasSkills = hasTable(db, "worker_skills");
  const skill = skillCategory && hasSkills ? db.prepare(`
    SELECT * FROM worker_skills
    WHERE user_id = ?
      AND (skill_category = ? OR skill_name = ?)
      AND proficiency_level >= ?
    ORDER BY proficiency_level DESC
    LIMIT 1
  `).get(user_id, skillCategory, skillCategory, minLevel) : null;

  const hasCertificates = hasTable(db, "worker_certificates");
  const certificate = certType && hasCertificates ? db.prepare(`
    SELECT * FROM worker_certificates
    WHERE user_id = ? AND cert_type = ? AND status = 'valid'
      AND (expiry_date IS NULL OR expiry_date >= date('now'))
    ORDER BY expiry_date IS NULL DESC, expiry_date DESC
    LIMIT 1
  `).get(user_id, certType) : null;

  const hasDocs = hasTable(db, "process_operation_docs");
  const requiredDocs = hasDocs ? db.prepare(`
    SELECT pod.*, d.status AS doc_status, da.id AS acknowledgement_id
    FROM process_operation_docs pod
    LEFT JOIN documents d ON d.id = pod.doc_id
    LEFT JOIN doc_acknowledgements da ON da.doc_id = d.id AND da.ack_by = ?
    WHERE pod.operation_template_id = ?
  `).all(user_id, node.operation_template_id) : [];
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

module.exports = { validateAssignment };
