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
  // 2026-11-07（文档 P0）：审批/电子签署、修订块、受控发放、机号有效性
  addColumn("approval_status", "approval_status TEXT DEFAULT 'draft'");
  addColumn("submitted_at", "submitted_at TEXT");
  addColumn("approved_at", "approved_at TEXT");
  addColumn("approved_by", "approved_by INTEGER");
  addColumn("revision_note", "revision_note TEXT");
  addColumn("revision_reason", "revision_reason TEXT");
  addColumn("effectivity_type", "effectivity_type TEXT DEFAULT 'all'");
  addColumn("effective_from", "effective_from TEXT");
  addColumn("effective_to", "effective_to TEXT");
  addColumn("serial_from", "serial_from TEXT");
  addColumn("serial_to", "serial_to TEXT");
  addColumn("classification", "classification TEXT DEFAULT 'internal'");
  addColumn("download_policy", "download_policy TEXT DEFAULT 'allow'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      version TEXT,
      page_no INTEGER DEFAULT 1,
      x_pct REAL,
      y_pct REAL,
      annotation_type TEXT DEFAULT 'note',
      content TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      parent_id INTEGER,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_by INTEGER,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS doc_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      step_no INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      approver_role TEXT,
      status TEXT DEFAULT 'pending',
      comment TEXT,
      signed_by INTEGER,
      signed_at TEXT,
      signature TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(doc_id, step_no)
    );
    CREATE TABLE IF NOT EXISTS document_distribution_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,
      role_code TEXT NOT NULL,
      department TEXT,
      mandatory INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_distribution_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_code TEXT,
      department TEXT,
      status TEXT DEFAULT 'pending',
      required_at TEXT,
      acked_at TEXT,
      ack_method TEXT,
      superseded_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(doc_id, user_id)
    );
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
