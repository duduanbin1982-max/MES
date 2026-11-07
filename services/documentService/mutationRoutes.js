"use strict";

const fs = require("fs");
const { ApiError } = require("../../app/errors");
const { ISSUE_TARGETS, validateMeta, sanitizeFileName, validateDocumentFile, retentionYears } = require("./meta");
const { resolveStoredFile } = require("./storage");
const audit = require("../../app/audit");
const { recordDocumentEvent } = require("./history");
const { onDocumentIssued } = require("./control");
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
      fileName = sanitizeFileName(fileName, `${meta.title}.bin`);
      const mimeType = req.headers["x-file-mime"] || "application/octet-stream";
      const buffer = req.body;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return next(ApiError.validation("请求体为空, 没收到文件数据"));
      const fileValidation = validateDocumentFile(fileName, mimeType, buffer.length);
      if (!fileValidation.ok) return next(ApiError.validation("文件校验失败", fileValidation.errors));
      if (!db.prepare("SELECT id FROM equipment_instances WHERE id = ?").get(meta.equipment_instance_id)) {
        return next(ApiError.validation(`equipment_instance_id 不存在: ${meta.equipment_instance_id}`));
      }

      const fileHash = sha256(buffer);

      // 2026-11-05（批量审计）：先做重复/BOM/ECO 校验，再落盘 —— 原来先写文件后校验，
      // 重复上传或 bom_node/eco 不存在时会留下孤儿文件（磁盘泄漏）。
      const duplicate = db.prepare("SELECT id, version FROM documents WHERE equipment_instance_id = ? AND file_hash = ? AND version = ?")
        .get(meta.equipment_instance_id, fileHash, meta.version || "A0");
      if (duplicate) return next(ApiError.conflict(`文件已存在 (id=${duplicate.id} version=${duplicate.version}), hash 相同`));

      if (meta.bom_node_id) {
        const bomNode = db.prepare("SELECT id, equipment_instance_id FROM instance_bom WHERE id = ?").get(meta.bom_node_id);
        if (!bomNode) return next(ApiError.validation(`bom_node_id 不存在: ${meta.bom_node_id}`));
        if (Number(bomNode.equipment_instance_id) !== Number(meta.equipment_instance_id)) {
          return next(ApiError.validation("bom_node_id 不属于该装备实例"));
        }
      }
      if (meta.eco_id) {
        try {
          if (!db.prepare("SELECT id FROM instance_eco WHERE id = ?").get(meta.eco_id)) return next(ApiError.validation(`eco_id 不存在: ${meta.eco_id}`));
        } catch (_error) { return next(ApiError.validation("ECO 表不可用，不能关联 eco_id")); }
      }
      let parentDocument = null;
      if (meta.parent_document_id) {
        parentDocument = db.prepare("SELECT id, equipment_instance_id, document_family_id FROM documents WHERE id = ?").get(meta.parent_document_id);
        if (!parentDocument) return next(ApiError.validation(`parent_document_id 不存在: ${meta.parent_document_id}`));
        if (Number(parentDocument.equipment_instance_id) !== Number(meta.equipment_instance_id)) {
          return next(ApiError.validation("parent_document_id 不属于该装备实例"));
        }
      }
      const familyId = parentDocument ? Number(parentDocument.document_family_id || parentDocument.id) : null;
      if (parentDocument && !parentDocument.document_family_id) {
        db.prepare("UPDATE documents SET document_family_id = ? WHERE id = ?").run(parentDocument.id, parentDocument.id);
      }
      if (familyId) {
        const sameVersion = db.prepare("SELECT id FROM documents WHERE document_family_id = ? AND version = ?")
          .get(familyId, meta.version || "A0");
        if (sameVersion) return next(ApiError.conflict(`同一文档版本已存在 (id=${sameVersion.id})`));
      } else if (meta.doc_code) {
        const sameVersion = db.prepare("SELECT id FROM documents WHERE equipment_instance_id = ? AND doc_code = ? AND version = ?")
          .get(meta.equipment_instance_id, meta.doc_code, meta.version || "A0");
        if (sameVersion) return next(ApiError.conflict(`同一文档编号与版本已存在 (id=${sameVersion.id})`));
      }

      const storage = buildStoragePath(fileName);
      fs.writeFileSync(storage.abs, buffer);

      const userId = req.user?.uid || null;
      const result = db.prepare(`INSERT INTO documents (
        equipment_instance_id, bom_node_id, eco_id,
        doc_type, doc_code, title, version,
        file_name, file_path, file_size, mime_type, file_hash,
        document_family_id, parent_document_id,
        status, issued_to, issued_at, issued_by,
        description, tags,
        doc_name, doc_no, uploaded_by, uploaded_at
      ) VALUES (
        @equipment_instance_id, @bom_node_id, @eco_id,
        @doc_type, @doc_code, @title, @version,
        @file_name, @file_path, @file_size, @mime_type, @file_hash,
        @document_family_id, @parent_document_id,
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
        document_family_id: familyId,
        parent_document_id: meta.parent_document_id || null,
        // 2026-11-05（文档链路深挖）：上传只能是 draft，签发必须走 PUT /:id/issue
        status: "draft",
        issued_to: null,
        issued_at: null,
        issued_by: null,
        description: meta.description || null,
        tags: meta.tags ? JSON.stringify(meta.tags) : null,
        uploaded_by: userId,
      });
      if (!familyId) {
        db.prepare("UPDATE documents SET document_family_id = ? WHERE id = ?").run(result.lastInsertRowid, result.lastInsertRowid);
      }
      const created = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
      recordDocumentEvent(db, {
        doc_id: created.id,
        action: "upload",
        to_status: created.status,
        version: created.version,
        issued_to: created.issued_to,
        operator_id: userId,
      });
      audit.record(db, req, {
        action: "document.upload",
        resource_type: "document",
        resource_id: created.id,
        after: { title: created.title, doc_type: created.doc_type, file_name: created.file_name, size: created.file_size, version: created.version },
        diff_summary: `上传文档 ${created.title}（${created.file_name}）`,
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
      const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      if (current.status === "issued") return next(ApiError.validation("文档已签发，不能重复签发"));
      if (current.approval_status === "in_review") return next(ApiError.validation("审批中的文档不能签发，请先完成审批"));
      if (current.approval_status === "rejected") return next(ApiError.validation("审批被驳回的文档不能签发，请修改后重新提交"));
      if (["revoked", "archived"].includes(current.status)) return next(ApiError.unprocessable("已收回/归档的文档不能签发"));
      if (!hasStoredFile(current.file_path)) return next(ApiError.unprocessable(`文件不存在，不能签发: ${current.file_name || req.params.id}`));
      db.prepare("UPDATE documents SET status='issued', issued_to=?, issued_at=datetime('now'), issued_by=?, updated_at=datetime('now') WHERE id=?")
        .run(issued_to, req.user?.uid || null, req.params.id);
      const issuedDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
      try { onDocumentIssued(db, issuedDoc); } catch (_error) { /* 发放生成失败不阻断签发 */ }
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "issue", from_status: current.status, to_status: "issued",
        version: current.version, issued_to, operator_id: req.user?.uid || null,
      });
      audit.record(db, req, {
        action: "document.issue",
        resource_type: "document",
        resource_id: req.params.id,
        after: { status: "issued", issued_to },
        diff_summary: `签发文档 ${current.version || ""} → ${issued_to}`,
      });
      res.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id));
    } catch (error) { next(error); }
  });

  app.put("/api/documents/:id/revoke", (req, res, next) => {
    try {
      const reason = req.body?.reason || "未指定原因";
      const current = db.prepare("SELECT id, status, version, issued_to FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      // 2026-11-05（文档链路深挖）：收回只能针对已签发文档，草稿/已归档不可收回
      if (current.status !== "issued") {
        return next(ApiError.validation("只能收回已签发的文档（当前状态: " + current.status + "）"));
      }
      db.prepare("UPDATE documents SET status='revoked', revoke_reason=?, revoked_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
        .run(reason, req.params.id);
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "revoke", from_status: current.status, to_status: "revoked",
        version: current.version, issued_to: current.issued_to, reason, operator_id: req.user?.uid || null,
      });
      audit.record(db, req, {
        action: "document.revoke",
        resource_type: "document",
        resource_id: req.params.id,
        after: { status: "revoked", reason },
        diff_summary: `收回文档：${reason}`,
      });
      res.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id));
    } catch (error) { next(error); }
  });

  app.delete("/api/documents/:id", (req, res, next) => {
    try {
      const current = db.prepare("SELECT id, status, version, issued_to FROM documents WHERE id = ?").get(req.params.id);
      if (!current) return next(ApiError.notFound("文档不存在"));
      // 2026-11-07（D-6）：归档时写入保留期（按文档类型），到期后可物理清理
      const docTypeRow = db.prepare("SELECT doc_type FROM documents WHERE id = ?").get(req.params.id);
      const retention = retentionYears(docTypeRow ? docTypeRow.doc_type : "other");
      try {
        db.prepare("UPDATE documents SET status='archived', retention_until = datetime('now', ?), updated_at=datetime('now') WHERE id=?")
          .run(`+${retention} years`, req.params.id);
      } catch (_error) {
        // 兼容未迁移 retention_until 列的旧库/测试库
        db.prepare("UPDATE documents SET status='archived', updated_at=datetime('now') WHERE id=?").run(req.params.id);
      }
      recordDocumentEvent(db, {
        doc_id: Number(req.params.id), action: "archive", from_status: current.status, to_status: "archived",
        version: current.version, issued_to: current.issued_to, operator_id: req.user?.uid || null,
      });
      audit.record(db, req, {
        action: "document.archive",
        resource_type: "document",
        resource_id: req.params.id,
        after: { status: "archived" },
        diff_summary: "归档文档",
      });
      res.json({ id: req.params.id, status: "archived" });
    } catch (error) { next(error); }
  });
}

function registerPurgeRoutes(app, db) {
  function purgeOne(req, doc, force) {
    if (doc.status !== "archived") throw ApiError.validation("只能清理已归档文档（当前: " + doc.status + "）");
    if (doc.purged_at) throw ApiError.validation("文档已清理");
    if (!force && doc.retention_until && new Date(doc.retention_until).getTime() > Date.now()) {
      throw ApiError.validation(`未到保留期截止日（${doc.retention_until}），不能清理`);
    }
    const absolute = resolveStoredFile(doc.file_path);
    if (absolute) { try { fs.unlinkSync(absolute); } catch (_error) { /* 文件缺失继续标记 */ } }
    db.prepare("UPDATE documents SET status='purged', purged_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(doc.id);
    recordDocumentEvent(db, { doc_id: doc.id, action: "purge", from_status: "archived", to_status: "purged", version: doc.version, operator_id: req.user?.uid || null });
    audit.record(db, req, {
      action: "document.purge",
      resource_type: "document",
      resource_id: doc.id,
      before: { status: "archived", file_path: doc.file_path },
      after: { status: "purged" },
      diff_summary: `物理清理文档 ${doc.title || doc.id}`,
    });
    return { id: doc.id, purged: true };
  }

  app.post("/api/documents/:id/purge", (req, res, next) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
      if (!doc) return next(ApiError.notFound("文档不存在"));
      const force = Boolean((req.body || {}).force) && req.user?.role === "admin";
      res.json(purgeOne(req, doc, force));
    } catch (error) { next(error); }
  });

  app.post("/api/documents/purge-expired", (req, res, next) => {
    try {
      const docs = db.prepare("SELECT * FROM documents WHERE status = 'archived' AND retention_until IS NOT NULL AND retention_until <= datetime('now')").all();
      const results = [];
      for (const doc of docs) {
        try { results.push(purgeOne(req, doc, false)); }
        catch (error) { results.push({ id: doc.id, purged: false, error: error.message }); }
      }
      res.json({ total: docs.length, purged: results.filter((item) => item.purged).length, results });
    } catch (error) { next(error); }
  });
}

function registerMutationRoutes(app, db) {
  registerUploadRoute(app, db);
  registerLifecycleRoutes(app, db);
  registerPurgeRoutes(app, db);
}

module.exports = { registerMutationRoutes, registerUploadRoute, registerLifecycleRoutes };
