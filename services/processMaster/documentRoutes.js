"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { createDbAccess, safeBool, toText } = require("./utils");

const DOC_TYPES = new Set(["sop", "drawing", "qc_std", "wps", "other"]);

function assertOperation(db, operationId) {
  const row = db.prepare("SELECT id FROM process_operation_templates WHERE id = ?").get(operationId);
  if (!row) throw ApiError.notFound("工序模板不存在");
  return row.id;
}

function assertDocument(db, docId) {
  if (docId === undefined || docId === null || docId === "") return null;
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("doc_id 非法");
  let tableReady;
  try {
    tableReady = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get());
  } catch (_error) {
    tableReady = false;
  }
  if (tableReady) {
    const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(id);
    if (!row) throw ApiError.validation(`文档不存在：${id}`);
  }
  return id;
}

function normalizeDocPayload(db, body, { partial = false } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("doc_type")) {
    const docType = toText(source.doc_type, "doc_type", { max: 30 }) || "sop";
    if (!DOC_TYPES.has(docType)) throw ApiError.validation(`doc_type 必须是 ${[...DOC_TYPES].join(" / ")}`);
    payload.doc_type = docType;
  }
  if (!partial || has("title")) payload.title = toText(source.title, "title", { required: true, max: 200 });
  if (!partial || has("doc_id")) payload.doc_id = assertDocument(db, source.doc_id);
  if (!partial || has("is_required")) payload.is_required = safeBool(source.is_required === undefined ? true : source.is_required);
  if (!partial || has("notes")) payload.notes = toText(source.notes, "notes", { max: 2000 });
  return payload;
}

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
    const operationId = assertOperation(db, Number(request.params.id));
    const payload = normalizeDocPayload(db, request.body || {}, { partial: false });
    if (payload.doc_id != null) {
      const duplicate = db.prepare(
        "SELECT id FROM process_operation_docs WHERE operation_template_id = ? AND doc_type = ? AND doc_id = ?"
      ).get(operationId, payload.doc_type, payload.doc_id);
      if (duplicate) throw ApiError.conflict(`该文档已绑定到此工序（id=${duplicate.id}）`);
    }
    const result = run(`
      INSERT INTO process_operation_docs
        (operation_template_id, doc_type, title, doc_id, is_required, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      operationId,
      payload.doc_type,
      payload.title,
      payload.doc_id,
      payload.is_required,
      payload.notes,
    ]);
    audit.record(db, request, {
      action: "process_master.operation_doc.create",
      resource_type: "process_operation_doc",
      resource_id: result.lastInsertRowid,
      after: { operation_template_id: operationId, ...payload },
      diff_summary: `工序模板 ${operationId} 绑定文档 ${payload.title}`,
    });
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id/docs/:docId", wrap((request, response) => {
    const before = db.prepare(
      "SELECT * FROM process_operation_docs WHERE id = ? AND operation_template_id = ?"
    ).get(request.params.docId, request.params.id);
    if (!before) throw ApiError.notFound("doc binding not found");
    const payload = normalizeDocPayload(db, request.body || {}, { partial: true });
    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(payload)) {
      sets.push(field + " = ?");
      params.push(value);
    }
    if (!sets.length) throw ApiError.validation("no fields to update");
    const nextType = payload.doc_type !== undefined ? payload.doc_type : before.doc_type;
    const nextDocId = payload.doc_id !== undefined ? payload.doc_id : before.doc_id;
    if (nextDocId != null) {
      const duplicate = db.prepare(
        "SELECT id FROM process_operation_docs WHERE operation_template_id = ? AND doc_type = ? AND doc_id = ? AND id <> ?"
      ).get(before.operation_template_id, nextType, nextDocId, before.id);
      if (duplicate) throw ApiError.conflict(`该文档已绑定到此工序（id=${duplicate.id}）`);
    }
    sets.push("updated_at = datetime('now')");
    params.push(before.id, before.operation_template_id);
    const result = run(
      "UPDATE process_operation_docs SET " + sets.join(", ") + " WHERE id = ? AND operation_template_id = ?",
      params,
    );
    if (!result.changes) throw ApiError.notFound("doc binding not found");
    audit.record(db, request, {
      action: "process_master.operation_doc.update",
      resource_type: "process_operation_doc",
      resource_id: before.id,
      before: { doc_type: before.doc_type, title: before.title, doc_id: before.doc_id, is_required: before.is_required },
      after: payload,
      diff_summary: `更新工序文档绑定 ${before.title}`,
    });
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id/docs/:docId", wrap((request, response) => {
    const before = db.prepare(
      "SELECT * FROM process_operation_docs WHERE id = ? AND operation_template_id = ?"
    ).get(request.params.docId, request.params.id);
    if (!before) throw ApiError.notFound("doc binding not found");
    run(
      "DELETE FROM process_operation_docs WHERE id = ? AND operation_template_id = ?",
      [before.id, before.operation_template_id],
    );
    audit.record(db, request, {
      action: "process_master.operation_doc.delete",
      resource_type: "process_operation_doc",
      resource_id: before.id,
      before: { doc_type: before.doc_type, title: before.title, doc_id: before.doc_id },
      diff_summary: `删除工序文档绑定 ${before.title}`,
    });
    response.json({ ok: true, deleted: true });
  }));
}

module.exports = { registerDocumentRoutes, normalizeDocPayload };
