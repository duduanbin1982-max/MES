"use strict";

const DOC_TYPES = ["drawing", "sop", "process", "qc_std", "contract", "report", "other"];
const DOC_STATUS = ["draft", "issued", "revoked", "archived"];
const ISSUE_TARGETS = ["assembly", "welding", "qc", "warehouse", "field", "design", "procurement", "management"];

function validateMeta(meta) {
  const errors = [];
  if (!meta.title || String(meta.title).trim().length === 0) errors.push("title 必填");
  if (!meta.doc_type || !DOC_TYPES.includes(meta.doc_type)) errors.push(`doc_type 必须是: ${DOC_TYPES.join("/")}`);
  if (meta.status && !DOC_STATUS.includes(meta.status)) errors.push(`status 必须是: ${DOC_STATUS.join("/")}`);
  if (meta.issued_to && !ISSUE_TARGETS.includes(meta.issued_to)) errors.push(`issued_to 必须是: ${ISSUE_TARGETS.join("/")}`);
  if (meta.bom_node_id !== undefined && meta.bom_node_id !== null && !Number.isInteger(Number(meta.bom_node_id))) {
    errors.push("bom_node_id 必须是整数");
  }
  if (meta.equipment_instance_id !== undefined && meta.equipment_instance_id !== null && !Number.isInteger(Number(meta.equipment_instance_id))) {
    errors.push("equipment_instance_id 必须是整数");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

module.exports = { DOC_TYPES, DOC_STATUS, ISSUE_TARGETS, validateMeta };
