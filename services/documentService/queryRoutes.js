"use strict";

const fs = require("fs");
const { ApiError } = require("../../app/errors");
const { documentEvents, documentFamilyIds } = require("./history");
const { humanSize, mimeToIcon, resolveStoredFile } = require("./storage");

function registerCollectionRoutes(app, db) {
  app.get("/api/documents", (req, res) => {
    const { equipment_instance_id, bom_node_id, eco_id, doc_type, status, issued_to, q } = req.query;
    let sql = `SELECT d.*, u1.full_name AS created_by_name, u2.full_name AS issued_by_name,
                      b.part_number AS bom_part_number, b.tier AS bom_tier,
                      ei.instance_code, ei.instance_name,
                      COALESCE(d.uploaded_at, d.uploaded_at) AS created_at_alias
               FROM documents d
               LEFT JOIN users u1 ON u1.id = COALESCE(d.uploaded_by, d.uploaded_by)
               LEFT JOIN users u2 ON u2.id = d.issued_by
               LEFT JOIN instance_bom b ON b.id = d.bom_node_id
               LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
               WHERE 1=1`;
    const params = [];
    if (equipment_instance_id) { sql += " AND d.equipment_instance_id = ?"; params.push(equipment_instance_id); }
    if (bom_node_id) { sql += " AND d.bom_node_id = ?"; params.push(bom_node_id); }
    if (eco_id) { sql += " AND d.eco_id = ?"; params.push(eco_id); }
    if (doc_type) { sql += " AND d.doc_type = ?"; params.push(doc_type); }
    if (status) { sql += " AND d.status = ?"; params.push(status); }
    if (issued_to) { sql += " AND d.issued_to = ?"; params.push(issued_to); }
    if (q) {
      sql += " AND (d.title LIKE ? OR d.doc_code LIKE ? OR d.file_name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY COALESCE(d.uploaded_at, d.uploaded_at) DESC LIMIT 500";
    const rows = db.prepare(sql).all(...params);
    rows.forEach((row) => {
      row.icon = mimeToIcon(row.mime_type);
      row.human_size = humanSize(row.file_size);
    });
    res.json({ items: rows, total: rows.length });
  });

  app.get("/api/documents/stats", (_req, res) => {
    const byStatus = db.prepare("SELECT status, COUNT(*) AS count FROM documents GROUP BY status").all();
    const byType = db.prepare("SELECT doc_type, COUNT(*) AS count FROM documents GROUP BY doc_type").all();
    const totalSize = db.prepare("SELECT COALESCE(SUM(file_size), 0) AS bytes FROM documents WHERE status != 'archived'").get();
    res.json({ by_status: byStatus, by_type: byType, total_bytes: totalSize.bytes, human_total: humanSize(totalSize.bytes) });
  });
}

function registerDetailRoutes(app, db) {
  app.get("/api/documents/:id", (req, res, next) => {
    const row = db.prepare(`
      SELECT d.*, u1.full_name AS created_by_name, u2.full_name AS issued_by_name,
             b.part_number AS bom_part_number, b.tier AS bom_tier,
             ei.instance_code, ei.instance_name,
             COALESCE(d.uploaded_at, d.uploaded_at) AS created_at_alias
      FROM documents d
      LEFT JOIN users u1 ON u1.id = COALESCE(d.uploaded_by, d.uploaded_by)
      LEFT JOIN users u2 ON u2.id = d.issued_by
      LEFT JOIN instance_bom b ON b.id = d.bom_node_id
      LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
      WHERE d.id = ?`).get(req.params.id);
    if (!row) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    row.icon = mimeToIcon(row.mime_type);
    row.human_size = humanSize(row.file_size);
    res.json(row);
  });

  app.get("/api/documents/:id/download", (req, res, next) => {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!row) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    const absolutePath = resolveStoredFile(row.file_path);
    if (!absolutePath) return next(ApiError.notFound(`文件已丢失: ${row.file_name}`));
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.file_name)}"`);
    res.setHeader("Content-Length", row.file_size || fs.statSync(absolutePath).size);
    fs.createReadStream(absolutePath).pipe(res);
  });

  app.get("/api/documents/:id/versions", (req, res) => {
    const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!current) return res.json({ items: [], current: null });
    let items = [];
    if (current.doc_code) {
      items = db.prepare("SELECT id, version, file_name, file_size, file_hash, status, issued_to, issued_at, COALESCE(uploaded_at, uploaded_at) AS created_at, COALESCE(uploaded_by, uploaded_by) AS created_by FROM documents WHERE doc_code = ? ORDER BY COALESCE(uploaded_at, uploaded_at) DESC").all(current.doc_code);
    } else if (current.file_hash) {
      items = db.prepare("SELECT id, version, file_name, file_size, file_hash, status, issued_to, issued_at, COALESCE(uploaded_at, uploaded_at) AS created_at, COALESCE(uploaded_by, uploaded_by) AS created_by FROM documents WHERE file_hash = ? ORDER BY COALESCE(uploaded_at, uploaded_at) DESC").all(current.file_hash);
    }
    items.forEach((row) => { row.human_size = humanSize(row.file_size); });
    res.json({ items, current: req.params.id, events: documentEvents(db, documentFamilyIds(db, current)) });
  });

  app.get("/api/documents/:id/history", (req, res, next) => {
    const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!current) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    const documentIds = documentFamilyIds(db, current);
    res.json({ doc_id: Number(req.params.id), document_ids: documentIds, events: documentEvents(db, documentIds) });
  });
}

module.exports = { registerCollectionRoutes, registerDetailRoutes };
