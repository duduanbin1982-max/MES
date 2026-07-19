"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { createDbAccess, safeBool } = require("./utils");

function registerDocumentRoutes(app, db) {
  const { all, run } = createDbAccess(db);

  app.get("/api/process-master/operations/:id/docs", wrap((request, response) => {
    const rows = all(`
      SELECT pod.*, d.title AS document_title, d.status AS document_status
      FROM process_operation_docs pod
      LEFT JOIN documents d ON d.id = pod.doc_id
      WHERE pod.operation_template_id = ?
      ORDER BY pod.doc_type, pod.id
    `, [request.params.id]);
    response.json({ items: rows });
  }));

  app.post("/api/process-master/operations/:id/docs", wrap((request, response) => {
    const body = request.body || {};
    if (!body.title) throw ApiError.validation("title required");
    const result = run(`
      INSERT INTO process_operation_docs
        (operation_template_id, doc_type, title, doc_id, is_required, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      Number(request.params.id),
      body.doc_type || "sop",
      String(body.title).trim(),
      body.doc_id || null,
      body.is_required !== false ? 1 : 0,
      body.notes || null,
    ]);
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id/docs/:docId", wrap((request, response) => {
    const body = request.body || {};
    const sets = [];
    const params = [];
    for (const field of ["doc_type", "title", "doc_id", "is_required", "notes"]) {
      if (body[field] !== undefined) {
        sets.push(field + " = ?");
        params.push(field === "is_required" ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("no fields to update");
    sets.push("updated_at = datetime('now')");
    params.push(request.params.docId, request.params.id);
    const result = run(
      "UPDATE process_operation_docs SET " + sets.join(", ") + " WHERE id = ? AND operation_template_id = ?",
      params,
    );
    if (!result.changes) throw ApiError.notFound("doc binding not found");
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id/docs/:docId", wrap((request, response) => {
    const result = run(
      "DELETE FROM process_operation_docs WHERE id = ? AND operation_template_id = ?",
      [request.params.docId, request.params.id],
    );
    if (!result.changes) throw ApiError.notFound("doc binding not found");
    response.json({ ok: true, deleted: true });
  }));
}

module.exports = { registerDocumentRoutes };
