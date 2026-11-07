"use strict";
// services/documentService/versioning.js
// 2026-11-07 严格文档版本管理：当前版/作废/版本号规则/锁定/回滚/历史下载权限
const { ApiError } = require("../../app/errors");
const audit = require("../../app/audit");
const { recordDocumentEvent } = require("./history");
const { resolveStoredFile } = require("./storage");

function parseVersion(value) {
  const match = String(value || "").trim().match(/^([A-Za-z]+)(\d{1,4})$/);
  if (!match) return null;
  return { letters: match[1].toUpperCase(), number: Number(match[2]), raw: match[0] };
}

function lettersToNumber(letters) {
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

function numberToLetters(value) {
  let n = value;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || "A";
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return String(left || "").localeCompare(String(right || ""));
  const letters = lettersToNumber(a.letters) - lettersToNumber(b.letters);
  if (letters !== 0) return letters;
  return a.number - b.number;
}

function incrementVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) return "A1";
  if (parsed.number >= 9) return `${numberToLetters(lettersToNumber(parsed.letters) + 1)}0`;
  return `${parsed.letters}${parsed.number + 1}`;
}

function familyIdOf(doc) {
  return Number(doc?.document_family_id || doc?.id || 0);
}

function familyDocs(db, doc) {
  const familyId = familyIdOf(doc);
  if (!familyId) return [doc];
  try {
    return db.prepare("SELECT * FROM documents WHERE document_family_id = ? OR id = ? ORDER BY id").all(familyId, familyId);
  } catch (_error) {
    return [doc];
  }
}

function currentVersionOf(db, doc) {
  const familyId = familyIdOf(doc);
  if (!familyId) return null;
  try {
    const current = db.prepare("SELECT * FROM documents WHERE (document_family_id = ? OR id = ?) AND is_current = 1 AND status NOT IN ('purged') ORDER BY id DESC LIMIT 1").get(familyId, familyId);
    if (current) return current;
    // 兼容严格版本管理上线前的历史数据：取最新已签发版本
    return db.prepare("SELECT * FROM documents WHERE (document_family_id = ? OR id = ?) AND status = 'issued' ORDER BY id DESC LIMIT 1").get(familyId, familyId) || null;
  } catch (_error) {
    return null;
  }
}

function maxVersionOf(db, doc) {
  let max = null;
  for (const row of familyDocs(db, doc)) {
    if (!parseVersion(row.version)) continue;
    if (!max || compareVersions(row.version, max) > 0) max = row.version;
  }
  return max;
}

function nextVersionOf(db, doc) {
  const max = maxVersionOf(db, doc);
  return max ? incrementVersion(max) : "A0";
}

function isQualityUser(req) {
  if (!req?.user) return false;
  const role = String(req.user.role || "").toLowerCase();
  const permissions = req.user.permissions || [];
  if (role === "admin" || role.includes("quality") || role.includes("audit") || role.includes("document_controller")) return true;
  return permissions.includes("*") || permissions.includes("document:history") || permissions.includes("document:secret");
}

function canViewHistorical(req, db, row) {
  if (!row) return false;
  const current = currentVersionOf(db, row);
  if (!current) return true;
  if (Number(row.id) === Number(current.id)) return true;
  if (isQualityUser(req)) return true;
  return false;
}

function assertVersionOrder(db, doc) {
  if (!parseVersion(doc.version)) return;
  const current = currentVersionOf(db, doc);
  if (current && Number(current.id) !== Number(doc.id) && parseVersion(current.version)) {
    if (compareVersions(doc.version, current.version) <= 0) {
      throw ApiError.validation(`新版本号 ${doc.version} 必须大于当前版本 ${current.version}`);
    }
  }
}

function applyIssueVersioning(db, docId, userId) {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(docId));
  if (!doc) return { superseded: 0 };
  const familyId = familyIdOf(doc);
  let siblings = [];
  try {
    siblings = db.prepare("SELECT id, version, status FROM documents WHERE (document_family_id = ? OR id = ?) AND id <> ? AND status IN ('issued','obsolete')").all(familyId, familyId, doc.id);
  } catch (_error) { /* 兼容旧库：无 document_family_id */ }
  for (const sibling of siblings) {
    try {
      db.prepare("UPDATE documents SET status='obsolete', is_current=0, obsolete_at=datetime('now'), superseded_by=?, updated_at=datetime('now') WHERE id=?")
        .run(doc.id, sibling.id);
      recordDocumentEvent(db, { doc_id: sibling.id, action: "supersede", from_status: sibling.status, to_status: "obsolete", version: sibling.version, reason: `由 v${doc.version} 替代`, operator_id: userId || null });
    } catch (_error) { /* 兼容旧库 */ }
  }
  try { db.prepare("UPDATE documents SET is_current=0 WHERE document_family_id = ? OR id = ?").run(familyId, familyId); } catch (_error) { /* 兼容旧库 */ }
  try {
    db.prepare("UPDATE documents SET is_current=1, version_locked=1, locked_at=datetime('now'), locked_by=?, updated_at=datetime('now') WHERE id=?")
      .run(userId || null, doc.id);
  } catch (_error) { /* 兼容旧库 */ }
  return { superseded: siblings.length, family_id: familyId };
}

function registerControlRoutes(app, db) {
  const getDoc = (id) => db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));

  app.get("/api/documents/:id/next-version", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    res.json({
      doc_id: doc.id, current_version: doc.version, is_current: Boolean(doc.is_current),
      suggested_version: nextVersionOf(db, doc), max_version: maxVersionOf(db, doc),
      current_effective: currentVersionOf(db, doc)?.version || null,
    });
  });

  app.get("/api/documents/:id/version-ledger", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    const familyId = familyIdOf(doc);
    const versions = db.prepare(`SELECT id, version, status, is_current, version_locked, approval_status, file_name, file_hash,
        issued_to, issued_at, uploaded_at, obsolete_at, superseded_by, revision_note, revision_reason
      FROM documents WHERE document_family_id = ? OR id = ? ORDER BY id DESC`).all(familyId, familyId);
    for (const version of versions) {
      try { version.ack_count = db.prepare("SELECT COUNT(*) c FROM doc_acknowledgements WHERE doc_id = ?").get(version.id).c; } catch (_error) { version.ack_count = 0; }
    }
    res.json({
      doc_id: doc.id, family_id: familyId,
      current: versions.find((item) => item.is_current) || null,
      suggested_next: nextVersionOf(db, doc), versions,
    });
  });

  app.post("/api/documents/:id/lock", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    if (doc.version_locked) return next(ApiError.validation("版本已锁定"));
    db.prepare("UPDATE documents SET version_locked=1, locked_at=datetime('now'), locked_by=?, updated_at=datetime('now') WHERE id=?").run(req.user?.uid || null, doc.id);
    recordDocumentEvent(db, { doc_id: doc.id, action: "lock", from_status: doc.status, to_status: doc.status, version: doc.version, reason: req.body?.reason || null, operator_id: req.user?.uid || null });
    audit.record(db, req, { action: "document.version_lock", resource_type: "document", resource_id: doc.id, after: { version_locked: 1 }, diff_summary: `锁定文档 v${doc.version}` });
    res.json({ ok: true, doc_id: doc.id, version_locked: 1 });
  });

  app.post("/api/documents/:id/unlock", (req, res, next) => {
    const doc = getDoc(req.params.id);
    if (!doc) return next(ApiError.notFound("文档不存在"));
    if (req.user?.role !== "admin" && !(req.user?.permissions || []).includes("*")) return next(ApiError.forbidden("仅管理员可解锁版本"));
    db.prepare("UPDATE documents SET version_locked=0, locked_at=NULL, locked_by=NULL, updated_at=datetime('now') WHERE id=?").run(doc.id);
    recordDocumentEvent(db, { doc_id: doc.id, action: "unlock", from_status: doc.status, to_status: doc.status, version: doc.version, reason: req.body?.reason || null, operator_id: req.user?.uid || null });
    audit.record(db, req, { action: "document.version_unlock", resource_type: "document", resource_id: doc.id, before: { version_locked: 1 }, after: { version_locked: 0 }, diff_summary: `解锁文档 v${doc.version}` });
    res.json({ ok: true, doc_id: doc.id, version_locked: 0 });
  });

  app.post("/api/documents/:id/rollback", (req, res, next) => {
    try {
      const target = getDoc(req.params.id);
      if (!target) return next(ApiError.notFound("文档不存在"));
      if (target.status === "purged") return next(ApiError.validation("已清理文档不能回滚"));
      const familyId = familyIdOf(target);
      let source = null;
      if (req.body?.source_document_id) {
        source = getDoc(req.body.source_document_id);
        if (!source) return next(ApiError.validation("回滚源版本不存在"));
        if (familyIdOf(source) !== familyId) return next(ApiError.validation("回滚源必须属于同一文档族"));
      } else {
        source = db.prepare(`SELECT * FROM documents WHERE (document_family_id = ? OR id = ?) AND id <> ? AND status IN ('obsolete','issued') ORDER BY id DESC LIMIT 1`).get(familyId, familyId, target.id);
      }
      if (!source) return next(ApiError.validation("没有可回滚的历史版本"));
      if (!resolveStoredFile(source.file_path)) return next(ApiError.validation("回滚源文件已丢失"));
      let version = nextVersionOf(db, target);
      for (let i = 0; i < 100; i += 1) {
        const exists = db.prepare("SELECT id FROM documents WHERE (document_family_id = ? OR id = ?) AND version = ?").get(familyId, familyId, version);
        if (!exists) break;
        version = incrementVersion(version);
      }
      const result = db.prepare(`INSERT INTO documents (
        equipment_instance_id, bom_node_id, eco_id, doc_type, doc_code, title, version, file_name, file_path, file_size,
        mime_type, file_hash, document_family_id, parent_document_id, status, approval_status, description, tags,
        doc_name, doc_no, uploaded_by, uploaded_at, revision_note, revision_reason, is_current, version_locked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft', ?, ?, ?, ?, ?, datetime('now'), ?, ?, 0, 0)`)
        .run(target.equipment_instance_id, target.bom_node_id || null, target.eco_id || null, target.doc_type, target.doc_code || null,
          target.title, version, source.file_name, source.file_path, source.file_size, source.mime_type, source.file_hash,
          familyId, target.id, target.description || null, target.tags || null, target.title, target.doc_code || null,
          req.user?.uid || null, `回滚自 v${source.version}`, String(req.body?.reason || `回滚到 v${source.version}`));
      recordDocumentEvent(db, { doc_id: Number(result.lastInsertRowid), action: "rollback", from_status: "obsolete", to_status: "draft", version, reason: `回滚自 v${source.version}`, operator_id: req.user?.uid || null });
      audit.record(db, req, { action: "document.rollback", resource_type: "document", resource_id: Number(result.lastInsertRowid), after: { version, source_id: source.id, source_version: source.version }, diff_summary: `文档回滚：v${source.version} → 新版本 v${version}` });
      res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), version, source_document_id: source.id, source_version: source.version, status: "draft" });
    } catch (error) { next(error); }
  });
}

module.exports = {
  parseVersion, compareVersions, incrementVersion, nextVersionOf, currentVersionOf,
  canViewHistorical, assertVersionOrder, applyIssueVersioning, registerControlRoutes,
};
