"use strict";
// services/documentService/control.js
// 2026-11-07 文档/图纸 P0：审批与电子签署、修订块、受控发放/签收、机号有效性
const crypto = require("crypto");
const { ApiError } = require("../../app/errors");
const audit = require("../../app/audit");
const { ISSUE_TARGET_ROLES } = require("./meta");
const { recordDocumentEvent } = require("./history");

const APPROVAL_CONFIG = {
  drawing: [
    { step_type: "check", approver_role: "engineer" },
    { step_type: "review", approver_role: "quality_supervisor" },
    { step_type: "approve", approver_role: "production_supervisor" },
  ],
  default: [
    { step_type: "check", approver_role: "engineer" },
    { step_type: "approve", approver_role: "production_supervisor" },
  ],
};

function isAdmin(user) {
  return user?.role === "admin" || (user?.permissions || []).includes("*");
}

function canApprove(user, step) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return String(user.role || "") === String(step.approver_role || "");
}

function signatureHash(doc, step, user, comment) {
  return crypto.createHash("sha256")
    .update(`${doc.id}|${doc.version || ""}|${step.step_no}|${step.step_type}|${user?.uid || user?.id || ""}|${comment || ""}|${new Date().toISOString()}`)
    .digest("hex");
}

function registerCollectionRoutes(app, db) {
  // 生效文件查询必须在 /documents/:id 之前注册
  app.get("/api/documents/effective", (req, res) => {
    const instanceId = req.query.instance_id ? Number(req.query.instance_id) : null;
    const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return res.status(400).json({ code: "VALIDATION_ERROR", message: "as_of 格式必须是 YYYY-MM-DD" });
    const docType = req.query.doc_type || null;
    let columns;
    try { columns = new Set(db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name)); } catch (_error) { columns = new Set(); }
    const where = ["d.status IN ('issued','archived')"];
    const params = [];
    if (instanceId) {
      where.push("(d.equipment_instance_id = ? OR " + (columns.has("effectivity_type") ? "d.effectivity_type = 'all'" : "0=1") + ")");
      params.push(instanceId);
    }
    if (docType) { where.push("d.doc_type = ?"); params.push(docType); }
    if (columns.has("effective_from")) {
      where.push("(d.effective_from IS NULL OR d.effective_from <= ?)");
      where.push("(d.effective_to IS NULL OR d.effective_to >= ?)");
      params.push(asOf, asOf);
    }
    const docs = db.prepare(`SELECT d.*, ei.instance_code FROM documents d LEFT JOIN equipment_instances ei ON d.equipment_instance_id = ei.id
      WHERE ${where.join(" AND ")} ORDER BY d.doc_type, d.version DESC LIMIT 500`).all(...params);
    res.json({ as_of: asOf, instance_id: instanceId, doc_type: docType, total: docs.length, items: docs });
  });

  app.get("/api/documents/distribution-overdue", (req, res) => {
    const days = Number(req.query.days || 3);
    const items = db.prepare(`SELECT t.*, d.title, d.doc_code, d.version, d.doc_type
      FROM document_distribution_targets t JOIN documents d ON d.id = t.doc_id
      WHERE t.status = 'pending' AND t.required_at <= datetime('now', ?)
      ORDER BY t.required_at LIMIT 500`).all(`-${Math.max(0, days)} day`);
    res.json({ total: items.length, items });
  });

  app.get("/api/document-distribution-rules", (_req, res) => {
    const items = db.prepare("SELECT * FROM document_distribution_rules ORDER BY doc_type, role_code").all();
    res.json({ total: items.length, items });
  });

  app.post("/api/document-distribution-rules", (req, res) => {
    const body = req.body || {};
    const docType = String(body.doc_type || "").trim();
    if (!docType) return res.status(400).json({ code: "VALIDATION_ERROR", message: "doc_type 必填" });
    const roleCode = String(body.role_code || "").trim();
    if (!roleCode) return res.status(400).json({ code: "VALIDATION_ERROR", message: "role_code 必填" });
    const result = db.prepare(`INSERT INTO document_distribution_rules (doc_type, role_code, department, mandatory, is_active)
      VALUES (?, ?, ?, ?, 1)`).run(docType, roleCode, body.department || null, body.mandatory === false ? 0 : 1);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
}

function registerControlRoutes(app, db) {
  const getDoc = (id) => db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
  const stepsOf = (docId) => db.prepare("SELECT * FROM doc_approvals WHERE doc_id = ? ORDER BY step_no").all(Number(docId));

  function ensureApprovalSteps(doc) {
    const existing = stepsOf(doc.id);
    if (existing.length) return existing;
    const config = APPROVAL_CONFIG[doc.doc_type] || APPROVAL_CONFIG.default;
    const insert = db.prepare("INSERT INTO doc_approvals (doc_id, step_no, step_type, approver_role, status) VALUES (?, ?, ?, ?, 'pending')");
    config.forEach((step, index) => insert.run(doc.id, index + 1, step.step_type, step.approver_role));
    return stepsOf(doc.id);
  }

  app.get("/api/documents/:id/approvals", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    res.json({ doc_id: doc.id, approval_status: doc.approval_status || "draft", steps: stepsOf(doc.id), approved_by: doc.approved_by || null, approved_at: doc.approved_at || null });
  });

  app.post("/api/documents/:id/submit", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    if (!["draft", "rejected"].includes(doc.status)) return next(ApiError.validation(`当前状态 ${doc.status} 不能提交审批`));
    const steps = ensureApprovalSteps(doc);
    db.prepare("UPDATE documents SET approval_status='in_review', submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(doc.id);
    recordDocumentEvent(db, { doc_id: doc.id, action: "submit_review", from_status: doc.status, to_status: doc.status, version: doc.version, operator_id: req.user?.uid || null });
    audit.record(db, req, { action: "document.submit_review", resource_type: "document", resource_id: doc.id, after: { steps: steps.length }, diff_summary: `文档《${doc.title}》提交审批` });
    res.json({ ok: true, doc_id: doc.id, approval_status: "in_review", steps });
  });

  app.post("/api/documents/:id/approve", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const stepId = Number(body.step_id);
    const stepNo = Number(body.step_no);
    const step = stepId
      ? stepsOf(doc.id).find((row) => row.id === stepId)
      : stepsOf(doc.id).find((row) => row.step_no === stepNo);
    if (!step) return next(ApiError.validation("审批步骤不存在"));
    if (step.status !== "pending") return next(ApiError.validation("该步骤已处理"));
    if (!canApprove(req.user, step)) return next(ApiError.forbidden(`当前角色不能执行该审批步骤（需要 ${step.approver_role}）`));
    const approve = body.action ? body.action === "approve" : true;
    const comment = String(body.comment || "").trim();
    const userId = req.user?.uid || req.user?.id || null;
    const signature = signatureHash(doc, step, req.user, comment);
    const tx = db.transaction(() => {
      db.prepare("UPDATE doc_approvals SET status=?, comment=?, signed_by=?, signed_at=datetime('now'), signature=? WHERE id=?")
        .run(approve ? "approved" : "rejected", comment || null, userId, signature, step.id);
      const all = stepsOf(doc.id);
      const pending = all.filter((row) => row.status === "pending");
      if (!approve) {
        db.prepare("UPDATE documents SET approval_status='rejected', updated_at=datetime('now') WHERE id=?").run(doc.id);
      } else if (!pending.length) {
        db.prepare("UPDATE documents SET approval_status='approved', approved_at=datetime('now'), approved_by=?, updated_at=datetime('now') WHERE id=?").run(userId, doc.id);
      }
    });
    tx();
    const status = db.prepare("SELECT approval_status FROM documents WHERE id=?").get(doc.id).approval_status;
    recordDocumentEvent(db, { doc_id: doc.id, action: approve ? "approve" : "reject", from_status: doc.status, to_status: doc.status, version: doc.version, reason: comment, operator_id: userId });
    audit.record(db, req, {
      action: approve ? "document.approve" : "document.reject", resource_type: "document", resource_id: doc.id,
      before: { step: step.step_no, role: step.approver_role }, after: { approval_status: status, signature, comment },
      diff_summary: `文档《${doc.title}》审批步骤 ${step.step_no} ${approve ? "通过" : "驳回"}`,
    });
    res.json({ ok: true, step_id: step.id, step_status: approve ? "approved" : "rejected", approval_status: status, signature });
  });

  if (typeof app.patch === "function") app.patch("/api/documents/:id/revision", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const note = body.revision_note == null ? null : String(body.revision_note).trim();
    const reason = body.revision_reason == null ? null : String(body.revision_reason).trim();
    if (!note && !reason) return next(ApiError.validation("revision_note 或 revision_reason 至少填一个"));
    db.prepare("UPDATE documents SET revision_note=?, revision_reason=?, updated_at=datetime('now') WHERE id=?").run(note, reason, doc.id);
    audit.record(db, req, { action: "document.revision_update", resource_type: "document", resource_id: doc.id, before: { revision_note: doc.revision_note, revision_reason: doc.revision_reason }, after: { revision_note: note, revision_reason: reason }, diff_summary: `文档《${doc.title}》修订说明更新` });
    res.json({ ok: true, doc_id: doc.id, revision_note: note, revision_reason: reason });
  });

  app.get("/api/documents/:id/revisions", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const familyId = doc.document_family_id || doc.id;
    const rows = db.prepare(`SELECT id, version, status, approval_status, revision_note, revision_reason, uploaded_at AS created_at, approved_at, issued_at
      FROM documents WHERE id = ? OR document_family_id = ? ORDER BY id`).all(doc.id, familyId);
    res.json({ doc_id: doc.id, current_version: doc.version, revisions: rows });
  });

  app.get("/api/documents/:id/distribution", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const targets = db.prepare(`SELECT t.*, u.full_name, u.username, u.role_code AS role FROM document_distribution_targets t LEFT JOIN users u ON u.id = t.user_id WHERE t.doc_id = ? ORDER BY t.status, t.id`).all(doc.id);
    res.json({ doc_id: doc.id, total: targets.length, acknowledged: targets.filter((row) => row.status === "acknowledged").length, targets });
  });

  app.post("/api/documents/:id/distribution/regenerate", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const count = generateDistributionTargets(db, doc, req.body?.required_days);
    res.json({ ok: true, doc_id: doc.id, targets: count });
  });

  app.post("/api/documents/distribution-targets/:id/ack", (req, res, next) => {
    const target = db.prepare("SELECT * FROM document_distribution_targets WHERE id = ?").get(Number(req.params.id));
    if (!target) return next(ApiError.notFound("发放对象不存在"));
    const userId = req.user?.uid || req.user?.id || null;
    if (!userId) return next(ApiError.unauthorized("未登录"));
    if (Number(target.user_id) !== Number(userId) && !isAdmin(req.user)) return next(ApiError.forbidden("只能签收自己的发放任务"));
    if (target.status === "acknowledged") return res.json({ ok: true, already: true });
    db.prepare("UPDATE document_distribution_targets SET status='acknowledged', acked_at=datetime('now'), ack_method='web' WHERE id=?").run(target.id);
    try { db.prepare("INSERT INTO doc_acknowledgements (doc_id, ack_by) VALUES (?, ?)").run(target.doc_id, userId); } catch (_error) { /* duplicate */ }
    res.json({ ok: true, target_id: target.id });
  });

  app.get("/api/documents/:id/effectivity", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    res.json({
      doc_id: doc.id, effectivity_type: doc.effectivity_type || "all", effective_from: doc.effective_from || null,
      effective_to: doc.effective_to || null, serial_from: doc.serial_from || null, serial_to: doc.serial_to || null,
      equipment_instance_id: doc.equipment_instance_id,
    });
  });

  app.put("/api/documents/:id/effectivity", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const type = String(body.effectivity_type || "all");
    if (!["all", "instance", "date_range", "serial_range"].includes(type)) return next(ApiError.validation("effectivity_type 必须是 all/instance/date_range/serial_range"));
    const from = body.effective_from ? String(body.effective_from) : null;
    const to = body.effective_to ? String(body.effective_to) : null;
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return next(ApiError.validation("有效日期格式必须是 YYYY-MM-DD"));
    if (from && to && from > to) return next(ApiError.validation("effective_from 不能晚于 effective_to"));
    db.prepare("UPDATE documents SET effectivity_type=?, effective_from=?, effective_to=?, serial_from=?, serial_to=?, updated_at=datetime('now') WHERE id=?")
      .run(type, from, to, body.serial_from || null, body.serial_to || null, doc.id);
    audit.record(db, req, { action: "document.effectivity", resource_type: "document", resource_id: doc.id, before: { effectivity_type: doc.effectivity_type, effective_from: doc.effective_from, effective_to: doc.effective_to }, after: { effectivity_type: type, effective_from: from, effective_to: to }, diff_summary: `文档《${doc.title}》有效性更新` });
    res.json({ ok: true, doc_id: doc.id, effectivity_type: type, effective_from: from, effective_to: to, serial_from: body.serial_from || null, serial_to: body.serial_to || null });
  });
}

// 签发时生成发放对象；新版本签发时旧版本待签收任务自动作废
function generateDistributionTargets(db, doc, requiredDays = 3) {
  let roles = ISSUE_TARGET_ROLES[doc.issued_to] || [];
  try {
    const ruleRoles = db.prepare("SELECT role_code FROM document_distribution_rules WHERE doc_type = ? AND is_active = 1").all(doc.doc_type).map((row) => row.role_code);
    roles = [...new Set([...roles, ...ruleRoles])];
  } catch (_error) { /* rules table may be absent */ }
  if (!roles.length) return 0;
  const placeholders = roles.map(() => "?").join(",");
  const users = db.prepare(`SELECT id, role_code AS role FROM users WHERE is_active = 1 AND role_code IN (${placeholders})`).all(...roles);
  const requiredAt = new Date(Date.now() + Number(requiredDays || 3) * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const insert = db.prepare(`INSERT INTO document_distribution_targets (doc_id, user_id, role_code, department, status, required_at)
    VALUES (?, ?, ?, ?, 'pending', ?)`);
  let count = 0;
  for (const user of users) {
    try {
      insert.run(doc.id, user.id, user.role, doc.issued_to || null, requiredAt);
      count += 1;
    } catch (_error) { /* duplicate */ }
  }
  // 旧版本未签收任务作废
  try {
    db.prepare(`UPDATE document_distribution_targets SET status='superseded', superseded_at=datetime('now')
      WHERE doc_id IN (SELECT id FROM documents WHERE document_family_id = ? AND id <> ?) AND status='pending'`).run(doc.document_family_id || doc.id, doc.id);
  } catch (_error) { /* ignore */ }
  return count;
}

function onDocumentIssued(db, doc) {
  return generateDistributionTargets(db, doc, 3);
}

function ackDistribution(db, docId, userId, method = "web") {
  try {
    db.prepare("UPDATE document_distribution_targets SET status='acknowledged', acked_at=datetime('now'), ack_method=? WHERE doc_id=? AND user_id=? AND status='pending'").run(method, docId, userId);
  } catch (_error) { /* ignore */ }
}

module.exports = { registerCollectionRoutes, registerControlRoutes, onDocumentIssued, ackDistribution, generateDistributionTargets };
