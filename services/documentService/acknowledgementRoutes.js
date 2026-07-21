"use strict";

const { recordDocumentEvent } = require("./history");

function registerAcknowledgementRoutes(app, db) {
  app.get("/api/documents/pending-ack", (req, res) => {
    const userId = req.user ? req.user.id : 1;
    const documents = db.prepare("SELECT d.*, ei.instance_code FROM documents d LEFT JOIN equipment_instances ei ON d.equipment_instance_id = ei.id WHERE d.status = 'issued' AND d.id NOT IN (SELECT doc_id FROM doc_acknowledgements WHERE ack_by = ?) ORDER BY d.issued_at DESC LIMIT 50").all(userId);
    res.json({ pending: documents, count: documents.length });
  });

  app.post("/api/documents/:id/acknowledge", (req, res) => {
    const document = db.prepare("SELECT id FROM documents WHERE id = ?").get(req.params.id);
    if (!document) return res.status(404).json({ error: "not found" });
    const userId = req.user ? req.user.id : 1;
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
