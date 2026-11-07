"use strict";
// services/documentService/enterprise.js
// 2026-11-07 文档 P1/P2：现场扫码/离线/借阅、供应商协同、法律保留/归档包、搜索联动
const crypto = require("crypto");
const { ApiError } = require("../../app/errors");
const audit = require("../../app/audit");
const { recordDocumentEvent } = require("./history");
const { canAccessDocument } = require("./access");
const { canViewClassification } = require("./p1");
const { onDocumentIssued } = require("./control");

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function isAdmin(user) {
  return user?.role === "admin" || (user?.permissions || []).includes("*") || (user?.permissions || []).includes("document:secret");
}
function effectiveClause(columns) {
  const clauses = [];
  if (columns.has("effective_from")) clauses.push("(effective_from IS NULL OR effective_from <= date('now'))");
  if (columns.has("effective_to")) clauses.push("(effective_to IS NULL OR effective_to >= date('now'))");
  return clauses.length ? " AND " + clauses.join(" AND ") : "";
}

function registerCollectionRoutes(app, db) {
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const all = (sql, params = []) => db.prepare(sql).all(params);

  function visibleDocs(req, rows) {
    return rows.filter((row) => canAccessDocument(req, db, row) && canViewClassification(req, row));
  }

  app.get("/api/documents/scan/:code", (req, res, next) => {
    try {
      const raw = String(req.params.code || "").trim();
      const [kind, ...rest] = raw.split(":");
      const value = rest.join(":").trim();
      let instance = null;
      let docs = [];
      let bomNode = null;
      let workstation = null;
      if ((kind === "EQ" || kind === "INSTANCE") && value) {
        instance = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ? OR instance_code = ?", [Number(value) || -1, value]);
      } else if (!kind || !value) {
        instance = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE instance_code = ? OR CAST(id AS TEXT) = ?", [raw, raw]);
      } else if (kind === "BOM" && value) {
        bomNode = get("SELECT id, equipment_instance_id, part_number FROM instance_bom WHERE id = ?", [Number(value)]);
        if (bomNode) instance = get("SELECT id, instance_code, instance_name FROM equipment_instances WHERE id = ?", [bomNode.equipment_instance_id]);
      } else if (kind === "WS" && value) {
        workstation = get("SELECT * FROM workstations WHERE code = ? OR CAST(id AS TEXT) = ?", [value, value]);
      } else if (kind === "DOC" && value) {
        const doc = get("SELECT * FROM documents WHERE id = ?", [Number(value)]);
        if (!doc) return next(ApiError.notFound("二维码对应的文档不存在"));
        return res.json({ qr: raw, kind: "document", document: doc, documents: [doc] });
      }
      if (!instance) return next(ApiError.notFound("未识别二维码或对象不存在: " + raw));
      let columns;
      try { columns = new Set(db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name)); } catch (_error) { columns = new Set(); }
      const classClause = columns.has("classification") && !isAdmin(req.user) ? "AND COALESCE(d.classification,'internal') <> 'secret'" : "";
      if (bomNode) {
        docs = all(`SELECT d.* FROM documents d WHERE d.bom_node_id = ? AND d.status IN ('issued','archived') ${classClause} ORDER BY d.doc_type, d.id DESC LIMIT 100`, [bomNode.id]);
      } else {
        docs = all(`SELECT d.* FROM documents d WHERE d.equipment_instance_id = ? AND d.status IN ('issued','archived') ${effectiveClause(columns)} ${classClause} ORDER BY d.doc_type, d.id DESC LIMIT 200`, [instance.id]);
      }
      docs = visibleDocs(req, docs);
      const groups = { drawing: [], sop: [], itp: [], checklist: [], other: [] };
      for (const doc of docs) {
        const type = String(doc.doc_type || "").toLowerCase();
        if (type.includes("sop") || type.includes("process")) groups.sop.push(doc);
        else if (type.includes("itp") || type.includes("qc") || type.includes("inspect")) groups.itp.push(doc);
        else if (type.includes("check") || type.includes("checklist")) groups.checklist.push(doc);
        else if (type.includes("drawing") || type.includes("图纸")) groups.drawing.push(doc);
        else groups.other.push(doc);
      }
      res.json({ qr: raw, kind: bomNode ? "bom" : (workstation ? "workstation" : "instance"), instance, bom_node: bomNode, workstation, documents: docs, groups, annotations: all(`SELECT COUNT(*) c FROM document_annotations WHERE doc_id IN (${docs.map(() => "?").join(",") || "NULL"})`, docs.map((doc) => doc.id))[0]?.c || 0 });
    } catch (error) { next(error); }
  });

  app.get("/api/documents/borrowings", (req, res) => {
    const openOnly = String(req.query.status || "open") === "open";
    const items = openOnly
      ? db.prepare(`SELECT b.*, d.title, d.doc_code, d.version, u.full_name FROM document_borrowings b
          LEFT JOIN documents d ON d.id = b.doc_id LEFT JOIN users u ON u.id = b.user_id
          WHERE b.action = 'borrow' AND b.id NOT IN (SELECT return_id FROM document_borrowings WHERE return_id IS NOT NULL)
          ORDER BY b.id DESC`).all()
      : db.prepare(`SELECT b.*, d.title, d.doc_code, d.version, u.full_name FROM document_borrowings b
          LEFT JOIN documents d ON d.id = b.doc_id LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 500`).all();
    res.json({ total: items.length, items });
  });

  app.get("/api/documents/supplier", (req, res) => {
    const where = ["d.supplier_id IS NOT NULL"];
    const params = [];
    if (req.query.supplier_id) { where.push("d.supplier_id = ?"); params.push(Number(req.query.supplier_id)); }
    if (req.query.status) { where.push("d.supplier_status = ?"); params.push(String(req.query.status)); }
    const items = db.prepare(`SELECT d.*, s.supplier_name FROM documents d LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT 300`).all(...params);
    res.json({ total: items.length, items });
  });

  app.get("/api/documents/supplier-expiring", (req, res) => {
    const days = Math.max(0, Number(req.query.days || 30));
    const items = db.prepare(`SELECT d.*, s.supplier_name FROM documents d LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.supplier_id IS NOT NULL AND d.effective_to IS NOT NULL AND d.effective_to <= date('now', ?)
      ORDER BY d.effective_to LIMIT 200`).all(`+${days} day`);
    res.json({ total: items.length, items });
  });

  app.get("/api/documents/facets", (req, res) => {
    const total = db.prepare("SELECT COUNT(*) c FROM documents").get().c;
    const byType = db.prepare("SELECT COALESCE(doc_type,'other') k, COUNT(*) c FROM documents GROUP BY doc_type").all();
    const byStatus = db.prepare("SELECT status k, COUNT(*) c FROM documents GROUP BY status").all();
    const byClass = db.prepare("SELECT COALESCE(classification,'internal') k, COUNT(*) c FROM documents GROUP BY classification").all();
    const byTag = db.prepare("SELECT tags FROM documents WHERE tags IS NOT NULL AND tags <> ''").all().flatMap((row) => String(row.tags).split(/[,，;；]/)).map((tag) => tag.trim()).filter(Boolean).reduce((map, tag) => { map.set(tag, (map.get(tag) || 0) + 1); return map; }, new Map());
    res.json({ total, by_type: byType, by_status: byStatus, by_classification: byClass, by_tag: [...byTag.entries()].map(([k, c]) => ({ k, c })) });
  });

  app.post("/api/documents/offline-sync", (req, res, next) => {
    try {
      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
      if (actions.length > 100) return next(ApiError.validation("单次最多同步 100 条离线操作"));
      const results = [];
      for (const action of actions) {
        const clientId = String(action.client_action_id || "").slice(0, 100);
        if (!clientId) { results.push({ client_action_id: null, status: "rejected", message: "client_action_id 必填" }); continue; }
        const exists = db.prepare("SELECT id FROM document_offline_actions WHERE client_action_id = ?").get(clientId);
        if (exists) { results.push({ client_action_id: clientId, status: "duplicate" }); continue; }
        const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(action.doc_id));
        if (!doc || !canAccessDocument(req, db, doc)) { results.push({ client_action_id: clientId, status: "rejected", message: "文档不存在" }); continue; }
        if (action.action === "ack") {
          try { db.prepare("INSERT INTO doc_acknowledgements (doc_id, ack_by, ack_method) VALUES (?, ?, 'offline')").run(doc.id, req.user?.uid || null); } catch (_error) { /* ignore */ }
          try { db.prepare("UPDATE document_distribution_targets SET status='acknowledged', acked_at=datetime('now'), ack_method='offline' WHERE doc_id=? AND user_id=? AND status='pending'").run(doc.id, req.user?.uid || null); } catch (_error) { /* ignore */ }
        } else if (action.action === "annotation") {
          const content = String(action.payload?.content || "").trim();
          if (!content) { results.push({ client_action_id: clientId, status: "rejected", message: "批注内容为空" }); continue; }
          db.prepare("INSERT INTO document_annotations (doc_id, version, page_no, content, annotation_type, photos_json, created_by) VALUES (?, ?, ?, ?, 'issue', ?, ?)")
            .run(doc.id, doc.version, Number(action.payload?.page_no) || 1, content, JSON.stringify(action.payload?.photos || []), req.user?.uid || null);
        } else {
          results.push({ client_action_id: clientId, status: "rejected", message: "不支持的离线动作" });
          continue;
        }
        db.prepare("INSERT INTO document_offline_actions (client_action_id, doc_id, action, payload_json, status) VALUES (?, ?, ?, ?, 'applied')")
          .run(clientId, doc.id, action.action, JSON.stringify(action.payload || {}));
        results.push({ client_action_id: clientId, status: "applied" });
      }
      res.json({ total: actions.length, applied: results.filter((item) => item.status === "applied").length, results });
    } catch (error) { next(error); }
  });

  app.post("/api/documents/batch/issue", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const issuedTo = String(req.body?.issued_to || "");
    if (!ids.length) return res.status(400).json({ code: "VALIDATION_ERROR", message: "ids 必填" });
    const results = [];
    for (const id of ids) {
      const doc = get("SELECT * FROM documents WHERE id = ?", [id]);
      if (!doc) { results.push({ id, status: "not_found" }); continue; }
      if (doc.approval_status === "in_review" || doc.approval_status === "rejected") { results.push({ id, status: "blocked", reason: "审批中/已驳回" }); continue; }
      try {
        db.prepare("UPDATE documents SET status='issued', issued_to=?, issued_at=datetime('now'), issued_by=?, updated_at=datetime('now') WHERE id=?").run(issuedTo || null, req.user?.uid || null, id);
        onDocumentIssued(db, get("SELECT * FROM documents WHERE id = ?", [id]));
        results.push({ id, status: "issued" });
      } catch (error) { results.push({ id, status: "error", reason: error.message }); }
    }
    audit.record(db, req, { action: "document.batch_issue", resource_type: "document", resource_id: ids.join(","), after: { count: results.filter((item) => item.status === "issued").length }, diff_summary: `批量签发 ${ids.length} 个文档` });
    res.json({ total: ids.length, results });
  });

  app.post("/api/documents/batch/archive", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ code: "VALIDATION_ERROR", message: "ids 必填" });
    const results = ids.map((id) => {
      const doc = get("SELECT * FROM documents WHERE id = ?", [id]);
      if (!doc) return { id, status: "not_found" };
      if (doc.status === "archived") return { id, status: "archived" };
      db.prepare("UPDATE documents SET status='archived', updated_at=datetime('now') WHERE id=?").run(id);
      return { id, status: "archived" };
    });
    audit.record(db, req, { action: "document.batch_archive", resource_type: "document", resource_id: ids.join(","), after: { count: ids.length }, diff_summary: `批量归档 ${ids.length} 个文档` });
    res.json({ total: ids.length, results });
  });

  app.get("/api/document-retention-policies", (_req, res) => {
    const items = db.prepare("SELECT * FROM document_retention_policies ORDER BY doc_type").all();
    res.json({ total: items.length, items });
  });

  app.post("/api/document-retention-policies", (req, res) => {
    const body = req.body || {};
    const docType = String(body.doc_type || "").trim();
    const years = Number(body.retention_years);
    if (!docType) return res.status(400).json({ code: "VALIDATION_ERROR", message: "doc_type 必填" });
    if (!Number.isFinite(years) || years < 1 || years > 100) return res.status(400).json({ code: "VALIDATION_ERROR", message: "retention_years 需在 1~100" });
    db.prepare(`INSERT INTO document_retention_policies (doc_type, retention_years, legal_basis, is_active)
      VALUES (?, ?, ?, 1) ON CONFLICT(doc_type) DO UPDATE SET retention_years=excluded.retention_years, legal_basis=excluded.legal_basis, is_active=1`)
      .run(docType, years, body.legal_basis || null);
    res.json({ ok: true, doc_type: docType, retention_years: years });
  });
}

function registerControlRoutes(app, db) {
  const getDoc = (id) => db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
  const guard = (req, doc) => doc && canAccessDocument(req, db, doc) && canViewClassification(req, doc);

  app.post("/api/documents/:id/borrow", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const active = db.prepare("SELECT id FROM document_borrowings WHERE doc_id = ? AND action = 'borrow' AND id NOT IN (SELECT return_id FROM document_borrowings WHERE return_id IS NOT NULL)").get(doc.id);
    if (active) return next(ApiError.validation("该文档已有未归还借阅记录"));
    const result = db.prepare("INSERT INTO document_borrowings (doc_id, user_id, copy_no, action, note) VALUES (?, ?, ?, 'borrow', ?)")
      .run(doc.id, req.user?.uid || null, req.body?.copy_no || null, req.body?.note || null);
    audit.record(db, req, { action: "document.borrow", resource_type: "document", resource_id: doc.id, after: { borrowing_id: Number(result.lastInsertRowid), copy_no: req.body?.copy_no || null }, diff_summary: `借阅文档《${doc.title}》` });
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  app.post("/api/documents/:id/return", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const borrowing = db.prepare("SELECT * FROM document_borrowings WHERE doc_id = ? AND action='borrow' AND id NOT IN (SELECT return_id FROM document_borrowings WHERE return_id IS NOT NULL) ORDER BY id DESC LIMIT 1").get(doc.id);
    if (!borrowing) return next(ApiError.validation("没有未归还的借阅记录"));
    const result = db.prepare("INSERT INTO document_borrowings (doc_id, user_id, copy_no, action, note, return_id) VALUES (?, ?, ?, 'return', ?, ?)")
      .run(doc.id, req.user?.uid || null, borrowing.copy_no, req.body?.note || null, borrowing.id);
    audit.record(db, req, { action: "document.return", resource_type: "document", resource_id: doc.id, after: { borrowing_id: borrowing.id }, diff_summary: `归还文档《${doc.title}》` });
    res.json({ ok: true, id: Number(result.lastInsertRowid), returned_borrowing: borrowing.id });
  });

  app.post("/api/documents/:id/field-issues", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const content = String(req.body?.content || "").trim();
    if (!content) return next(ApiError.validation("content 必填"));
    const photos = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 10) : [];
    const result = db.prepare("INSERT INTO document_annotations (doc_id, version, page_no, x_pct, y_pct, annotation_type, content, photos_json, created_by) VALUES (?, ?, ?, ?, ?, 'issue', ?, ?, ?)")
      .run(doc.id, doc.version, Number(req.body?.page_no) || 1, req.body?.x_pct ?? null, req.body?.y_pct ?? null, content, JSON.stringify(photos), req.user?.uid || null);
    recordDocumentEvent(db, { doc_id: doc.id, action: "field_issue", from_status: doc.status, to_status: doc.status, version: doc.version, reason: content, operator_id: req.user?.uid || null });
    audit.record(db, req, { action: "document.field_issue", resource_type: "document", resource_id: doc.id, after: { annotation_id: Number(result.lastInsertRowid), photos: photos.length }, diff_summary: `现场问题反馈《${doc.title}》` });
    res.status(201).json({ ok: true, annotation_id: Number(result.lastInsertRowid) });
  });

  app.get("/api/documents/:id/related", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const items = db.prepare(`SELECT d.* FROM documents d WHERE d.id <> ? AND (
        (? IS NOT NULL AND d.bom_node_id = ?) OR d.equipment_instance_id = ? OR (? <> '' AND d.doc_code = ?) OR
        (? IS NOT NULL AND d.tags = ?)
      ) ORDER BY d.id DESC LIMIT 30`).all(doc.id, doc.bom_node_id, doc.bom_node_id, doc.equipment_instance_id, doc.doc_code || "", doc.doc_code || "", doc.tags || null, doc.tags || null);
    res.json({ doc_id: doc.id, total: items.length, items: items.filter((row) => canViewClassification(req, row)) });
  });

  app.put("/api/documents/:id/supplier", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const supplierId = Number(req.body?.supplier_id);
    if (!supplierId) return next(ApiError.validation("supplier_id 必填"));
    if (tableExists(db, "suppliers") && !db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId)) return next(ApiError.validation("供应商不存在"));
    const poId = req.body?.purchase_order_id ? Number(req.body.purchase_order_id) : null;
    if (poId && tableExists(db, "purchase_orders") && !db.prepare("SELECT id FROM purchase_orders WHERE id = ?").get(poId)) return next(ApiError.validation("采购订单不存在"));
    db.prepare("UPDATE documents SET supplier_id=?, purchase_order_id=?, supplier_status='submitted', updated_at=datetime('now') WHERE id=?").run(supplierId, poId, doc.id);
    audit.record(db, req, { action: "document.supplier_link", resource_type: "document", resource_id: doc.id, after: { supplier_id: supplierId, purchase_order_id: poId }, diff_summary: `文档《${doc.title}》关联供应商/采购单` });
    res.json({ ok: true, doc_id: doc.id, supplier_id: supplierId, purchase_order_id: poId, supplier_status: "submitted" });
  });

  app.post("/api/documents/:id/supplier/review", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    if (!doc.supplier_id) return next(ApiError.validation("文档未关联供应商"));
    const approve = Boolean(req.body?.approve);
    const comment = String(req.body?.comment || "");
    db.prepare("UPDATE documents SET supplier_status=?, supplier_comment=?, supplier_reviewed_at=datetime('now'), supplier_reviewed_by=?, updated_at=datetime('now') WHERE id=?")
      .run(approve ? "approved" : "rejected", comment, req.user?.uid || null, doc.id);
    audit.record(db, req, { action: "document.supplier_review", resource_type: "document", resource_id: doc.id, before: { supplier_status: doc.supplier_status }, after: { supplier_status: approve ? "approved" : "rejected", comment }, diff_summary: `供应商文档《${doc.title}》${approve ? "通过" : "驳回"}` });
    res.json({ ok: true, doc_id: doc.id, supplier_status: approve ? "approved" : "rejected" });
  });

  app.post("/api/documents/:id/supplier/ack", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const result = db.prepare("INSERT INTO supplier_document_acks (doc_id, supplier_id, ack_by, note) VALUES (?, ?, ?, ?)")
      .run(doc.id, doc.supplier_id || null, req.user?.uid || null, req.body?.note || null);
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  app.get("/api/documents/:id/legal-holds", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const items = db.prepare("SELECT * FROM document_legal_holds WHERE doc_id = ? ORDER BY id DESC").all(doc.id);
    res.json({ doc_id: doc.id, total: items.length, items });
  });

  app.post("/api/documents/:id/legal-hold", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return next(ApiError.validation("reason 必填"));
    const result = db.prepare("INSERT INTO document_legal_holds (doc_id, reason, scope, created_by) VALUES (?, ?, ?, ?)")
      .run(doc.id, reason, req.body?.scope || null, req.user?.uid || null);
    audit.record(db, req, { action: "document.legal_hold", resource_type: "document", resource_id: doc.id, after: { hold_id: Number(result.lastInsertRowid), reason }, diff_summary: `文档《${doc.title}》设置法律保留` });
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  if (typeof app.delete === "function") app.delete("/api/document-legal-holds/:id", (req, res, next) => {
    const hold = db.prepare("SELECT * FROM document_legal_holds WHERE id = ?").get(Number(req.params.id));
    if (!hold) return next(ApiError.notFound("法律保留不存在"));
    db.prepare("UPDATE document_legal_holds SET status='released', released_at=datetime('now') WHERE id=?").run(hold.id);
    res.json({ ok: true, id: hold.id, status: "released" });
  });

  app.get("/api/documents/:id/archive-package", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const events = db.prepare("SELECT * FROM document_events WHERE doc_id = ? ORDER BY id").all(doc.id);
    const approvals = db.prepare("SELECT step_no, step_type, approver_role, status, comment, signed_by, signed_at, signature FROM doc_approvals WHERE doc_id = ? ORDER BY step_no").all(doc.id);
    const annotations = db.prepare("SELECT id, page_no, annotation_type, content, status, created_at FROM document_annotations WHERE doc_id = ? ORDER BY id").all(doc.id);
    const holds = db.prepare("SELECT id, reason, status, created_at FROM document_legal_holds WHERE doc_id = ?").all(doc.id);
    const payload = { document: doc, events, approvals, annotations, legal_holds: holds };
    const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    res.json({ ...payload, generated_at: new Date().toISOString(), package_hash: hash, algorithm: "sha256" });
  });

  app.get("/api/documents/:id/archive-package/verify", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc || !guard(req, doc)) return next(ApiError.notFound("文档不存在"));
    const expected = String(req.query.hash || "");
    const events = db.prepare("SELECT * FROM document_events WHERE doc_id = ? ORDER BY id").all(doc.id);
    const approvals = db.prepare("SELECT step_no, step_type, approver_role, status, comment, signed_by, signed_at, signature FROM doc_approvals WHERE doc_id = ? ORDER BY step_no").all(doc.id);
    const annotations = db.prepare("SELECT id, page_no, annotation_type, content, status, created_at FROM document_annotations WHERE doc_id = ? ORDER BY id").all(doc.id);
    const holds = db.prepare("SELECT id, reason, status, created_at FROM document_legal_holds WHERE doc_id = ?").all(doc.id);
    const payload = { document: doc, events, approvals, annotations, legal_holds: holds };
    const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    res.json({ doc_id: doc.id, expected, actual: hash, valid: Boolean(expected) && expected === hash });
  });
}

module.exports = { registerCollectionRoutes, registerControlRoutes };
