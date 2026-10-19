"use strict";

const fs = require("fs");
const { ApiError } = require("../../app/errors");
const { ISSUE_TARGETS, validateMeta } = require("./meta");
const { recordDocumentEvent } = require("./history");
const { buildStoragePath, hasStoredFile, sha256 } = require("./storage");

function registerUploadRoute(app, db) {
  app.post("/api/documents", (req, res, next) => {
    try {
      let meta = {};
      try {
        // 2026-10-19：前端把 JSON 做了 encodeURIComponent（header 只能是 ISO-8859-1）。
        // 这里先解码；未编码的旧客户端（或裸 JSON 里本身含 %）解码失败时按原样解析，保持兼容。
        let metaRaw = String(req.headers["x-doc-meta"] || "{}");
        try {
          metaRaw = decodeURIComponent(metaRaw);
        } catch (_decodeError) {
          /* 保持原样 */
        }
        meta = JSON.parse(metaRaw);
      } catch (_error) {
        return next(ApiError.validation("X-Doc-Meta 不是合法 JSON"));
      }
      const validation = validateMeta(meta);
      if (!validation.ok) return next(ApiError.validation("文档元数据校验失败", validation.errors));

      let fileName = req.headers["x-file-name"] || `${meta.title}.bin`;
      try { fileName = decodeURIComponent(String(fileName)); } catch (_error) { fileName = String(fileName); }
      const mimeType = req.headers["x-file-mime"] || "application/octet-stream";
      const buffer = req.body;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return next(ApiError.validation("请求体为空, 没收到文件数据"));

      const fileHash = sha256(buffer);
      const storage = buildStoragePath(fileName);
      fs.writeFileSync(storage.abs, buffer);

      const duplicate = db.prepare("SELECT id, version FROM documents WHERE equipment_instance_id = ? AND file_hash = ? AND version = ?")
        .get(meta.equipment_instance_id, fileHash, meta.version || "A0");
      if (duplicate) return next(ApiError.conflict(`文件已存在 (id=${duplicate.id} version=${duplicate.version}), hash 相同`));

      if (meta.bom_node_id && !db.prepare("SELECT id FROM instance_bom WHERE id = ?").get(meta.bom_node_id)) {
        return next(ApiError.validation(`bom_node_id 不存在: ${meta.bom_node_id}`));
      }
      if (meta.eco_id && !db.prepare("SELECT id FROM instance_eco WHERE id = ?").get(meta.eco_id)) {
        return next(ApiError.validation(`eco_id 不存在: ${meta.eco_id}`));
      }

      const userId = req.user?.uid || null;
      const result = db.prepare(`INSERT INTO documents (
        equipment_instance_id, bom_node_id, eco_id,
        doc_type, doc_code, title, version,
        file_name, file_path, file_size, mime_type, file_hash,
        status, issued_to, issued_at, issued_by,
        description, tags,
        doc_name, doc_no, uploaded_by, uploaded_at
      ) VALUES (
        @equipment_instance_id, @bom_node_id, @eco_id,
        @doc_type, @doc_code, @title, @version,
        @file_name, @file_path, @file_size, @mime_type, @file_hash,
        @status, @issued_to, @issued_at, @issued_by,
        @description, @tags,
        @title, @doc_code, @uploaded_by, datetime('now')
      )`).run({
        equipment_instance_id: meta.equipment_instance_id || null,
        bom_node_id: meta.bom_node_id || null,
        eco_id: meta.eco_id || null,
        doc_type: meta.doc_type,
        doc_code: meta.doc_code || null,
        title: meta.title,
        version: meta.version || "A0",
        file_name: fileName,
        file_path: storage.rel,
        file_size: buffer.length,
        mime_type: mimeType,
        file_hash: fileHash,
        status: meta.status || "draft",
        issued_to: meta.issued_to || null,
        issued_at: meta.status === "issued" ? new Date().toISOString() : null,
        issued_by: meta.issued_by || userId,
        description: meta.description || null,
        tags: meta.tags ? JSON.stringify(meta.tags) : null,
        uploaded_by: userId,
      });
      const created = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
      recordDocumentEvent(db, {
        doc_id: created.id,
        action: "upload",
        to_status: created.status,
        version: created.version,
        issued_to: created.issued_to,
        operator_id: userId,
      });
      res.json(created);
    } catch (error) {
      next(error);
    }
  });
}

function registerLifecycleRoutes(app, db) {
  app.put("/api/documents/:id/issue", (req, res, next) => {
    try {
      const { issued_to } = req.body || {};
      if (!issued_to || !ISSUE_TARGETS.includes(issued_to)) return next(ApiError.validation(`issued_to 必须是: ${ISSUE_TARGETS.join("/")}`));
      const current = db.prepare("SELECT id, status, file_path, file_name, version FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      if (["revoked", "archived"].includes(current.status)) return next(ApiError.unprocessable("已收回/归档的文档不能签发"));
      if (!hasStoredFile(current.file_path)) return next(ApiError.unprocessable(`文件不存在，不能签发: ${current.file_name || req.params.id}`));
      db.prepare("UPDATE documents SET status='issued', issued_to=?, issued_at=datetime('now'), issued_by=?, updated_at=datetime('now') WHERE id=?")
        .run(issued_to, req.user?.uid || null, req.params.id);
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "issue", from_status: current.status, to_status: "issued",
        version: current.version, issued_to, operator_id: req.user?.uid || null,
      });
      res.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id));
    } catch (error) { next(error); }
  });

  app.put("/api/documents/:id/revoke", (req, res, next) => {
    try {
      const reason = req.body?.reason || "未指定原因";
      const current = db.prepare("SELECT id, status, version, issued_to FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      db.prepare("UPDATE documents SET status='revoked', revoke_reason=?, revoked_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
        .run(reason, req.params.id);
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "revoke", from_status: current.status, to_status: "revoked",
        version: current.version, issued_to: current.issued_to, reason, operator_id: req.user?.uid || null,
      });
      res.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id));
    } catch (error) { next(error); }
  });

  app.delete("/api/documents/:id", (req, res, next) => {
    try {
      const current = db.prepare("SELECT id, status, version, issued_to FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      db.prepare("UPDATE documents SET status='archived', updated_at=datetime('now') WHERE id=?").run(req.params.id);
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "archive", from_status: current.status, to_status: "archived",
        version: current.version, issued_to: current.issued_to, operator_id: req.user?.uid || null,
      });
      res.json({ id: req.params.id, status: "archived" });
    } catch (error) { next(error); }
  });
}

function registerMutationRoutes(app, db) {
  registerUploadRoute(app, db);
  registerLifecycleRoutes(app, db);
}

module.exports = { registerMutationRoutes, registerUploadRoute, registerLifecycleRoutes };
