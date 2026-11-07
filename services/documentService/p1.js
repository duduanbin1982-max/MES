"use strict";
// services/documentService/p1.js
// 2026-11-07 文档/图纸 P1：批注/Redline、密级与下载策略、与 BOM/ECO/工艺/工单联动
const { ApiError } = require("../../app/errors");
const audit = require("../../app/audit");
const { recordDocumentEvent } = require("./history");
const { canAccessDocument } = require("./access");
const { humanSize, mimeToIcon } = require("./storage");

const CLASSIFICATIONS = ["public", "internal", "confidential", "secret"];
const DOWNLOAD_POLICIES = ["allow", "preview_only", "watermark_only", "no_print"];
const ANNOTATION_TYPES = ["note", "issue", "change"];
const ANNOTATION_STATUSES = ["open", "resolved"];

function isAdmin(user) {
  return user?.role === "admin" || (user?.permissions || []).includes("*") || (user?.permissions || []).includes("document:secret");
}

function canViewClassification(req, row) {
  if (!row) return false;
  if (row.classification !== "secret") return true;
  return isAdmin(req.user);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function registerCollectionRoutes(app, db) {
  const buildScopeClause = (req, alias = "d") => {
    // 复用 access 的数据范围语义（不直接依赖 scopeWhere 的分页 SQL 拼接）
    const scope = typeof req.scope === "function" ? req.scope() : null;
    if (!scope || scope.scope === "all") return { clause: "", params: [] };
    if (scope.scope === "instance") {
      const ids = [...(scope.config?.project_ids || []), ...(scope.config?.instance_ids || [])].map(Number).filter(Boolean);
      if (!ids.length) return { clause: "1=0", params: [] };
      return { clause: `${alias}.equipment_instance_id IN (${ids.map(() => "?").join(",")})`, params: ids };
    }
    if (scope.scope === "self") return { clause: `${alias}.uploaded_by = ?`, params: [req.user?.uid || 0] };
    if (scope.scope === "workshop") return { clause: `${alias}.equipment_instance_id IN (SELECT id FROM equipment_instances WHERE subsystem_id IN (${(scope.config?.subsystem_ids || []).map(() => "?").join(",") || "NULL"}))`, params: scope.config?.subsystem_ids || [] };
    return { clause: "1=0", params: [] };
  };

  function listBy(field, paramName) {
    return (req, res) => {
      const value = req.params[paramName];
      const scope = buildScopeClause(req);
      let columns;
      try { columns = new Set(db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name)); } catch (_error) { columns = new Set(); }
      const classClause = columns.has("classification") && !isAdmin(req.user) ? "AND COALESCE(d.classification,'internal') <> 'secret'" : "";
      const rows = db.prepare(`SELECT d.*, b.part_number, ei.instance_code FROM documents d
        LEFT JOIN instance_bom b ON b.id = d.bom_node_id
        LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
        WHERE d.${field} = ? ${scope.clause ? "AND " + scope.clause : ""} ${classClause}
        ORDER BY d.id DESC LIMIT 200`).all(value, ...scope.params);
      rows.forEach((row) => { row.icon = mimeToIcon(row.mime_type); row.human_size = humanSize(row.file_size); });
      res.json({ total: rows.length, items: rows });
    };
  }

  app.get("/api/documents/by-bom/:bomNodeId", listBy("bom_node_id", "bomNodeId"));
  app.get("/api/documents/by-eco/:ecoId", listBy("eco_id", "ecoId"));
  app.get("/api/documents/by-work-order/:workOrderId", listBy("work_order_id", "workOrderId"));

  app.get("/api/documents/annotations", (req, res) => {
    const docId = Number(req.query.doc_id || 0);
    if (!docId) return res.status(400).json({ code: "VALIDATION_ERROR", message: "doc_id 必填" });
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
    if (!doc || !canAccessDocument(req, db, doc) || !canViewClassification(req, doc)) return res.status(404).json({ code: "NOT_FOUND", message: "文档不存在" });
    const items = db.prepare(`SELECT a.*, u.full_name, u.username FROM document_annotations a LEFT JOIN users u ON u.id = a.created_by WHERE a.doc_id = ? ORDER BY a.status, a.id DESC`).all(docId);
    res.json({ doc_id: docId, total: items.length, items });
  });
}

function registerControlRoutes(app, db) {
  const getDoc = (id) => db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
  const guard = (req, row) => canAccessDocument(req, db, row) && canViewClassification(req, row);

  app.get("/api/documents/:id/annotations", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const status = req.query.status ? String(req.query.status) : null;
    const items = status
      ? db.prepare(`SELECT a.*, u.full_name, u.username FROM document_annotations a LEFT JOIN users u ON u.id = a.created_by WHERE a.doc_id = ? AND a.status = ? ORDER BY a.id DESC`).all(doc.id, status)
      : db.prepare(`SELECT a.*, u.full_name, u.username FROM document_annotations a LEFT JOIN users u ON u.id = a.created_by WHERE a.doc_id = ? ORDER BY a.status, a.id DESC`).all(doc.id);
    res.json({ doc_id: doc.id, version: doc.version, total: items.length, items });
  });

  app.post("/api/documents/:id/annotations", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const content = String(body.content || "").trim();
    if (!content) return next(ApiError.validation("content 必填"));
    if (content.length > 2000) return next(ApiError.validation("content 长度不能超过 2000"));
    const type = String(body.annotation_type || "note");
    if (!ANNOTATION_TYPES.includes(type)) return next(ApiError.validation("annotation_type 必须是 note/issue/change"));
    const pageNo = body.page_no ? Number(body.page_no) : 1;
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 9999) return next(ApiError.validation("page_no 非法"));
    const xPct = body.x_pct === undefined || body.x_pct === null || body.x_pct === "" ? null : Number(body.x_pct);
    const yPct = body.y_pct === undefined || body.y_pct === null || body.y_pct === "" ? null : Number(body.y_pct);
    if ((xPct !== null && (!Number.isFinite(xPct) || xPct < 0 || xPct > 100)) || (yPct !== null && (!Number.isFinite(yPct) || yPct < 0 || yPct > 100))) {
      return next(ApiError.validation("x_pct/y_pct 需在 0~100"));
    }
    const result = db.prepare(`INSERT INTO document_annotations (doc_id, version, page_no, x_pct, y_pct, annotation_type, content, parent_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(doc.id, doc.version, pageNo, xPct, yPct, type, content, body.parent_id || null, req.user?.uid || null);
    recordDocumentEvent(db, { doc_id: doc.id, action: "annotate", from_status: doc.status, to_status: doc.status, version: doc.version, reason: type, operator_id: req.user?.uid || null });
    audit.record(db, req, { action: "document.annotate", resource_type: "document", resource_id: doc.id, after: { annotation_id: Number(result.lastInsertRowid), type, page_no: pageNo }, diff_summary: `文档《${doc.title}》新增批注` });
    res.status(201).json(db.prepare("SELECT * FROM document_annotations WHERE id = ?").get(Number(result.lastInsertRowid)));
  });

  if (typeof app.patch === "function") app.patch("/api/document-annotations/:id", (req, res, next) => {
    const annotation = db.prepare("SELECT * FROM document_annotations WHERE id = ?").get(Number(req.params.id));
    if (!annotation) return next(ApiError.notFound("批注不存在"));
    const doc = getDoc(annotation.doc_id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const status = body.status === undefined ? annotation.status : String(body.status);
    if (!ANNOTATION_STATUSES.includes(status)) return next(ApiError.validation("status 必须是 open/resolved"));
    const content = body.content === undefined ? annotation.content : String(body.content).trim();
    if (!content) return next(ApiError.validation("content 不能为空"));
    db.prepare("UPDATE document_annotations SET status = ?, content = ?, resolved_by = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE NULL END WHERE id = ?")
      .run(status, content, status === "resolved" ? (req.user?.uid || null) : null, status, annotation.id);
    audit.record(db, req, { action: "document.annotation_update", resource_type: "document_annotation", resource_id: annotation.id, before: { status: annotation.status, content: annotation.content }, after: { status, content }, diff_summary: `更新文档批注 #${annotation.id}` });
    res.json(db.prepare("SELECT * FROM document_annotations WHERE id = ?").get(annotation.id));
  });

  if (typeof app.delete === "function") app.delete("/api/document-annotations/:id", (req, res, next) => {
    const annotation = db.prepare("SELECT * FROM document_annotations WHERE id = ?").get(Number(req.params.id));
    if (!annotation) return next(ApiError.notFound("批注不存在"));
    const doc = getDoc(annotation.doc_id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    if (Number(annotation.created_by) !== Number(req.user?.uid) && !isAdmin(req.user)) return next(ApiError.forbidden("只能删除自己的批注"));
    db.prepare("DELETE FROM document_annotations WHERE id = ?").run(annotation.id);
    audit.record(db, req, { action: "document.annotation_delete", resource_type: "document_annotation", resource_id: annotation.id, before: annotation, diff_summary: `删除文档批注 #${annotation.id}` });
    res.json({ ok: true, id: annotation.id });
  });

  app.get("/api/documents/:id/compare", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const other = getDoc(req.query.with_document_id);
    if (!other || !guard(req, other)) return next(ApiError.notFound("对比文档不存在"));
    const fields = ["title", "doc_code", "version", "status", "doc_type", "file_name", "file_size", "file_hash", "mime_type", "approval_status", "revision_note", "revision_reason", "classification", "download_policy", "effectivity_type", "effective_from", "effective_to", "serial_from", "serial_to", "bom_node_id", "eco_id", "work_order_id"];
    const changes = fields.filter((field) => String(doc[field] ?? "") !== String(other[field] ?? "")).map((field) => ({ field, left: doc[field] ?? null, right: other[field] ?? null }));
    const annCount = (id) => db.prepare("SELECT COUNT(*) c FROM document_annotations WHERE doc_id = ?").get(id).c;
    res.json({
      left: { id: doc.id, version: doc.version }, right: { id: other.id, version: other.version },
      file_changed: String(doc.file_hash || "") !== String(other.file_hash || ""),
      changes,
      annotations: { left: annCount(doc.id), right: annCount(other.id) },
      approvals: {
        left: db.prepare("SELECT step_no, step_type, status, approver_role, signed_at FROM doc_approvals WHERE doc_id = ? ORDER BY step_no").all(doc.id),
        right: db.prepare("SELECT step_no, step_type, status, approver_role, signed_at FROM doc_approvals WHERE doc_id = ? ORDER BY step_no").all(other.id),
      },
    });
  });

  app.get("/api/documents/:id/links", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const bom = doc.bom_node_id && tableExists(db, "instance_bom") ? db.prepare("SELECT id, part_number, tier, material_id, quantity FROM instance_bom WHERE id = ?").get(doc.bom_node_id) : null;
    const eco = doc.eco_id && tableExists(db, "instance_eco") ? db.prepare("SELECT * FROM instance_eco WHERE id = ?").get(doc.eco_id) : null;
    const workOrder = doc.work_order_id && tableExists(db, "work_orders") ? db.prepare("SELECT id, order_no, status FROM work_orders WHERE id = ?").get(doc.work_order_id) : null;
    const processNodes = doc.bom_node_id && tableExists(db, "process_nodes")
      ? db.prepare("SELECT id, operation_name, status FROM process_nodes WHERE bom_node_id = ? LIMIT 50").all(doc.bom_node_id) : [];
    const family = db.prepare("SELECT id, version, status FROM documents WHERE document_family_id = ? ORDER BY id").all(doc.document_family_id || doc.id);
    const annotations = db.prepare("SELECT COUNT(*) c FROM document_annotations WHERE doc_id = ?").get(doc.id).c;
    res.json({ doc_id: doc.id, bom, eco, work_order: workOrder, process_nodes: processNodes, family_versions: family, annotation_count: annotations });
  });

  app.get("/api/documents/:id/classification", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    res.json({ doc_id: doc.id, classification: doc.classification || "internal", download_policy: doc.download_policy || "allow" });
  });

  app.put("/api/documents/:id/classification", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const body = req.body || {};
    const classification = String(body.classification || doc.classification || "internal");
    const policy = String(body.download_policy || doc.download_policy || "allow");
    if (!CLASSIFICATIONS.includes(classification)) return next(ApiError.validation("classification 必须是 public/internal/confidential/secret"));
    if (!DOWNLOAD_POLICIES.includes(policy)) return next(ApiError.validation("download_policy 必须是 allow/preview_only/watermark_only/no_print"));
    db.prepare("UPDATE documents SET classification = ?, download_policy = ?, updated_at = datetime('now') WHERE id = ?").run(classification, policy, doc.id);
    audit.record(db, req, { action: "document.classification", resource_type: "document", resource_id: doc.id, before: { classification: doc.classification, download_policy: doc.download_policy }, after: { classification, download_policy: policy }, diff_summary: `文档《${doc.title}》密级/下载策略更新` });
    res.json({ ok: true, doc_id: doc.id, classification, download_policy: policy });
  });

  app.get("/api/documents/:id/conversion", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const mime = String(doc.mime_type || "");
    const nativePreview = mime.includes("pdf") || mime.startsWith("image/") || mime.startsWith("text/");
    const converter = process.env.DOCUMENT_CONVERTER_BIN || "";
    res.json({
      doc_id: doc.id, mime_type: mime, file_name: doc.file_name,
      native_preview: nativePreview,
      convertible: !nativePreview && Boolean(converter),
      converter_configured: Boolean(converter),
      message: nativePreview ? "原生预览" : (converter ? "可调用外部转换器转 PDF" : "当前服务器未配置 CAD/Office 转换器，请下载查看"),
    });
  });
}

module.exports = { registerCollectionRoutes, registerControlRoutes, canViewClassification };
