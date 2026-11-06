"use strict";

const { ensureDocumentHistorySchema } = require("./history");

function ensureDocumentSchema(db) {
  ensureDocumentHistorySchema(db);
  // 2026-11-07（文档审计 D-6）：显式版本链 + 保留期/物理清理 + 预览
  const columns = new Set(db.prepare("PRAGMA table_info(documents)").all().map((column) => column.name));
  const addColumn = (name, ddl) => { if (!columns.has(name)) db.exec(`ALTER TABLE documents ADD COLUMN ${ddl}`); };
  addColumn("document_family_id", "document_family_id INTEGER");
  addColumn("parent_document_id", "parent_document_id INTEGER");
  addColumn("retention_until", "retention_until TEXT");
  addColumn("purged_at", "purged_at TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      ack_by INTEGER NOT NULL,
      ack_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ack_method TEXT DEFAULT 'web'
    )
  `);
}

module.exports = { ensureDocumentSchema };
