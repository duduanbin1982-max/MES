"use strict";

const fs = require("fs");
const { ApiError } = require("../../app/errors");
const { documentEvents, documentFamilyIds, recordDocumentEvent } = require("./history");
const { scopeWhere, canAccessDocument } = require("./access");
const { sanitizeFileName } = require("./meta");
const { canViewClassification } = require("./p1");
const { humanSize, mimeToIcon, resolveStoredFile } = require("./storage");

function registerCollectionRoutes(app, db) {
  app.get("/api/documents", (req, res) => {
    const { equipment_instance_id, bom_node_id, eco_id, doc_type, status, issued_to, q } = req.query;
    const scope = scopeWhere(req, db, "d");
    let sql = `SELECT d.*, u1.full_name AS created_by_name, u2.full_name AS issued_by_name,
                      b.part_number AS bom_part_number, b.tier AS bom_tier,
                      ei.instance_code, ei.instance_name,
                      COALESCE(d.uploaded_at, d.uploaded_at) AS created_at_alias
               FROM documents d
               LEFT JOIN users u1 ON u1.id = COALESCE(d.uploaded_by, d.uploaded_by)
               LEFT JOIN users u2 ON u2.id = d.issued_by
               LEFT JOIN instance_bom b ON b.id = d.bom_node_id
               LEFT JOIN equipment_instances ei ON ei.id = d.equipment_instance_id
               WHERE 1=1` + (scope.clause ? " AND " + scope.clause : "");
    const params = [...scope.params];
    const isAdminUser = req.user?.role === "admin" || (req.user?.permissions || []).includes("*") || (req.user?.permissions || []).includes("document:secret");
    if (!isAdminUser) sql += " AND COALESCE(d.classification, 'internal') <> 'secret'";
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 50));
    const countSql = sql.replace(/^SELECT d\.\*[\s\S]*? FROM documents d/, "SELECT COUNT(*) AS c FROM documents d");
    const countRow = db.prepare(countSql).get(...params);
    sql += ` ORDER BY COALESCE(d.uploaded_at, d.uploaded_at) DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, pageSize, (page - 1) * pageSize);
    rows.forEach((row) => {
      row.icon = mimeToIcon(row.mime_type);
      row.human_size = humanSize(row.file_size);
    });
    res.json({ items: rows, total: countRow.c, page, page_size: pageSize });
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
    if (!canAccessDocument(req, db, row)) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    if (!canViewClassification(req, row)) return next(ApiError.forbidden("无权查看该密级文档"));
    row.icon = mimeToIcon(row.mime_type);
    row.human_size = humanSize(row.file_size);
    res.json(row);
  });

  app.get("/api/documents/:id/download", (req, res, next) => {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!row) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    if (!canAccessDocument(req, db, row)) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    if (!canViewClassification(req, row)) return next(ApiError.forbidden("无权下载该密级文档"));
    if (row.download_policy === "preview_only") return next(ApiError.forbidden("该文档仅允许在线预览，禁止下载"));
    const absolutePath = resolveStoredFile(row.file_path);
    if (!absolutePath) return next(ApiError.notFound(`文件已丢失: ${row.file_name}`));
    const safeName = sanitizeFileName(row.file_name);
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
    recordDocumentEvent(db, {
      doc_id: row.id,
      action: "download",
      from_status: row.status,
      to_status: row.status,
      version: row.version,
      issued_to: row.issued_to,
      operator_id: req.user?.uid || req.user?.sub || null,
    });
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (row.download_policy === "no_print") res.setHeader("X-No-Print", "1");
    if (row.download_policy === "watermark_only" || row.classification === "confidential" || row.classification === "secret") {
      res.setHeader("X-Document-Watermark", encodeURIComponent(`${req.user?.username || req.user?.full_name || "user"}@${new Date().toISOString()}`));
    }
    res.setHeader("Content-Length", row.file_size || fs.statSync(absolutePath).size);
    fs.createReadStream(absolutePath).pipe(res);
  });

  app.get("/api/documents/:id/preview", (req, res, next) => {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!row) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    if (!canAccessDocument(req, db, row)) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    if (!canViewClassification(req, row)) return next(ApiError.forbidden("无权预览该密级文档"));
    const mime = String(row.mime_type || "");
    const previewable = mime.includes("pdf") || mime.startsWith("image/") || mime.startsWith("text/");
    if (!previewable) return next(ApiError.validation("该文件类型不支持在线预览，请下载查看: " + (row.file_name || "")));
    const absolutePath = resolveStoredFile(row.file_path);
    if (!absolutePath) return next(ApiError.notFound(`文件已丢失: ${row.file_name}`));
    recordDocumentEvent(db, { doc_id: row.id, action: "preview", from_status: row.status, to_status: row.status, version: row.version, issued_to: row.issued_to, operator_id: req.user?.uid || req.user?.sub || null });
    const safeName = sanitizeFileName(row.file_name);
    res.setHeader("Content-Type", mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${safeName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader("X-Document-Watermark", encodeURIComponent(`${req.user?.username || req.user?.full_name || "user"}@${new Date().toISOString()}`));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    fs.createReadStream(absolutePath).pipe(res);
  });

  app.get("/api/documents/:id/versions", (req, res) => {
    const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!current || !canAccessDocument(req, db, current)) return res.json({ items: [], current: null });
    // 2026-11-05（文档链路深挖）：doc_code 常带版本后缀（ZZ-001-A0/A1），按 family 聚合版本
    const familyIds = documentFamilyIds(db, current);
    let items = [];
    if (familyIds.length) {
      const placeholders = familyIds.map(() => "?").join(",");
      items = db.prepare(`SELECT id, version, file_name, file_size, file_hash, status, issued_to, issued_at,
                                 COALESCE(uploaded_at, uploaded_at) AS created_at, COALESCE(uploaded_by, uploaded_by) AS created_by
                          FROM documents WHERE id IN (${placeholders})
                          ORDER BY version DESC, COALESCE(uploaded_at, uploaded_at) DESC`).all(...familyIds);
    }
    items.forEach((row) => { row.human_size = humanSize(row.file_size); });
    res.json({ items, current: req.params.id, events: documentEvents(db, documentFamilyIds(db, current)) });
  });

  app.get("/api/documents/:id/history", (req, res, next) => {
    const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!current || !canAccessDocument(req, db, current)) return next(ApiError.notFound(`文档不存在: ${req.params.id}`));
    const documentIds = documentFamilyIds(db, current);
    res.json({ doc_id: Number(req.params.id), document_ids: documentIds, events: documentEvents(db, documentIds) });
  });
}

module.exports = { registerCollectionRoutes, registerDetailRoutes };
