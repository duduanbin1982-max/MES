"use strict";

const path = require("path");

const DOC_TYPES = ["drawing", "sop", "process", "qc_std", "contract", "report", "other"];
const DOC_STATUS = ["draft", "issued", "revoked", "archived", "obsolete"];
const ISSUE_TARGETS = ["assembly", "welding", "qc", "warehouse", "field", "design", "procurement", "management"];

// 2026-11-07（文档审计）：允许的文档类型 + 50MB 上限；拒绝可执行/脚本/HTML/SVG 等
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "dwg", "dxf", "step", "stp", "iges", "igs", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "zip", "rar", "7z",
]);
const BLOCKED_EXTENSIONS = new Set(["exe", "js", "mjs", "html", "htm", "svg", "sh", "bat", "cmd", "ps1", "vbs", "jar", "msi"]);
const MAX_DOCUMENT_BYTES = Math.min(50 * 1024 * 1024, Number(process.env.DOCUMENT_MAX_BYTES) || 50 * 1024 * 1024);

function sanitizeFileName(name, fallback = "document.bin") {
  const base = path.basename(String(name || "").replace(/\\/g, "/"));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/[<>:"|?*]/g, "_").trim().slice(0, 200);
  return cleaned || fallback;
}

function validateDocumentFile(fileName, mimeType, size) {
  const errors = [];
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (!fileName) errors.push("文件名必填");
  else if (BLOCKED_EXTENSIONS.has(ext)) errors.push("不允许上传该类型文件: ." + ext);
  else if (!ALLOWED_EXTENSIONS.has(ext)) errors.push("不支持的文件类型: ." + ext + "（支持 pdf/dwg/dxf/office/图片/压缩包等）");
  const bytes = Number(size) || 0;
  if (bytes <= 0) errors.push("文件内容为空");
  else if (bytes > MAX_DOCUMENT_BYTES) errors.push(`文件超过大小上限 ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB`);
  const mime = String(mimeType || "").toLowerCase();
  if (mime && mime !== "application/octet-stream") {
    const allowed = mime.startsWith("image/") || mime.startsWith("text/") ||
      mime.includes("pdf") || mime.includes("word") || mime.includes("excel") ||
      mime.includes("spreadsheet") || mime.includes("presentation") || mime.includes("zip") ||
      mime.includes("dwg") || mime.includes("dxf") || mime.includes("acad") || mime.includes("octet-stream");
    if (!allowed) errors.push("不支持的文件 MIME 类型: " + mimeType);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// 2026-11-07（文档审计 D-6）：签发对象 → 允许签收的角色
const ISSUE_TARGET_ROLES = {
  assembly: ["worker", "welder", "foreman", "production_supervisor", "assembly_worker"],
  welding: ["welder", "foreman", "production_supervisor"],
  qc: ["qc", "inspector", "quality_supervisor", "foreman"],
  warehouse: ["warehouse", "storekeeper", "warehouse_supervisor"],
  field: ["foreman", "engineer", "commissioning_engineer", "production_supervisor"],
  design: ["engineer", "technology", "project_manager"],
  procurement: ["purchaser", "planner", "purchase_supervisor"],
  management: ["admin", "production_supervisor", "project_manager"],
};

// 保留期（年）：默认 5 年，可按类型覆盖
const RETENTION_YEARS = { drawing: 10, sop: 10, process: 10, qc_std: 10, contract: 7, report: 5, other: 5 };

function retentionYears(docType) {
  const configured = Number(process.env["DOC_RETENTION_YEARS_" + String(docType || "other").toUpperCase()]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return RETENTION_YEARS[docType] || Number(process.env.DOC_RETENTION_YEARS_DEFAULT) || 5;
}

function canAcknowledge(role, issuedTo) {
  if (!issuedTo) return false;
  const roleCode = String(role || "").toLowerCase();
  if (!roleCode) return true; // 兼容历史 token/内部服务调用（JWT 正常都带 role）
  if (roleCode === "admin") return true;
  return (ISSUE_TARGET_ROLES[issuedTo] || []).includes(roleCode);
}

function validateMeta(meta) {
  const errors = [];
  if (!meta.title || String(meta.title).trim().length === 0) errors.push("title 必填");
  // 2026-10-19：documents.equipment_instance_id 是 NOT NULL，不校验就会抛 SqliteError → 500
  if (meta.equipment_instance_id === undefined || meta.equipment_instance_id === null || meta.equipment_instance_id === "") {
    errors.push("equipment_instance_id 必填（文档需关联到某台装备实例）");
  }
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

module.exports = {
  DOC_TYPES, DOC_STATUS, ISSUE_TARGETS, validateMeta,
  ALLOWED_EXTENSIONS, BLOCKED_EXTENSIONS, MAX_DOCUMENT_BYTES, sanitizeFileName, validateDocumentFile,
  ISSUE_TARGET_ROLES, RETENTION_YEARS, retentionYears, canAcknowledge,
};
