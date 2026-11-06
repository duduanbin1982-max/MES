"use strict";

const { ApiError } = require("../../app/errors");
const { recordDocumentEvent } = require("./history");
const { canAcknowledge } = require("./meta");

function currentUserId(req) {
  return (req.user && (req.user.uid || req.user.id)) || null;
}

function registerAcknowledgementRoutes(app, db) {
  app.get("/api/documents/pending-ack", (req, res) => {
    const userId = currentUserId(req);
    if (!userId) return res.json({ pending: [], count: 0 });
    const role = req.user?.role;
    const documents = db.prepare("SELECT d.*, ei.instance_code FROM documents d LEFT JOIN equipment_instances ei ON d.equipment_instance_id = ei.id WHERE d.status = 'issued' AND d.id NOT IN (SELECT doc_id FROM doc_acknowledgements WHERE ack_by = ?) ORDER BY d.issued_at DESC LIMIT 200").all(userId)
      .filter((doc) => canAcknowledge(role, doc.issued_to));
    res.json({ pending: documents, count: documents.length });
  });

  app.post("/api/documents/:id/acknowledge", (req, res, next) => {
    const document = db.prepare("SELECT id, status, issued_to FROM documents WHERE id = ?").get(req.params.id);
    if (!document) return res.status(404).json({ error: "not found" });
    // 2026-11-05（文档链路深挖）：只有已签发文档可签收；草稿/已收回/已归档不能签收
    if (document.status !== "issued") {
      return next(ApiError.validation("只能签收已签发的文档（当前状态: " + document.status + "）"));
    }
    const userId = currentUserId(req);
    if (!userId) return next(ApiError.unauthorized("未登录，不能签收"));
    if (!canAcknowledge(req.user?.role, document.issued_to)) {
      return next(ApiError.forbidden("当前角色不能签收该文档（签发对象: " + (document.issued_to || "-") + "）"));
    }
    if (db.prepare("SELECT id FROM doc_acknowledgements WHERE doc_id = ? AND ack_by = ?").get(req.params.id, userId)) {
      return res.json({ ok: true, already: true });
    }
    db.prepare("INSERT INTO doc_acknowledgements (doc_id, ack_by) VALUES (?, ?)").run(req.params.id, userId);
    const acknowledged = db.prepare("SELECT id, status, version, issued_to FROM documents WHERE id = ?").get(req.params.id);
    recordDocumentEvent(db, {
      doc_id: Number(req.params.id),
      action: "acknowledge",
      from_status: acknowledged?.status,
      to_status: acknowledged?.status,
      version: acknowledged?.version,
      issued_to: acknowledged?.issued_to,
      operator_id: userId,
    });
    res.json({ ok: true });
  });

  app.get("/api/documents/:id/acknowledgements", (req, res) => {
    const acknowledgements = db.prepare("SELECT da.*, u.full_name, u.username FROM doc_acknowledgements da LEFT JOIN users u ON da.ack_by = u.id WHERE da.doc_id = ? ORDER BY da.ack_at DESC").all(req.params.id);
    res.json({ doc_id: Number(req.params.id), total: acknowledgements.length, acknowledgements });
  });
}

module.exports = { registerAcknowledgementRoutes };
