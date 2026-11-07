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
  // 2026-11-07（文档 P1/P2）：供应商协同、借阅、法律保留
  addColumn("supplier_id", "supplier_id INTEGER");
  addColumn("purchase_order_id", "purchase_order_id INTEGER");
  addColumn("supplier_status", "supplier_status TEXT");
  addColumn("supplier_comment", "supplier_comment TEXT");
  addColumn("supplier_reviewed_at", "supplier_reviewed_at TEXT");
  addColumn("supplier_reviewed_by", "supplier_reviewed_by INTEGER");
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
    CREATE TABLE IF NOT EXISTS document_borrowings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      user_id INTEGER,
      copy_no TEXT,
      action TEXT DEFAULT 'borrow',
      note TEXT,
      return_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_offline_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_action_id TEXT UNIQUE,
      doc_id INTEGER,
      action TEXT,
      payload_json TEXT,
      status TEXT DEFAULT 'applied',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS supplier_document_acks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      supplier_id INTEGER,
      ack_by INTEGER,
      ack_at TEXT DEFAULT (datetime('now')),
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS document_legal_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      scope TEXT,
      status TEXT DEFAULT 'active',
      released_at TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS document_retention_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL UNIQUE,
      retention_years INTEGER NOT NULL,
      legal_basis TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS doc_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      ack_by INTEGER NOT NULL,
      ack_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ack_method TEXT DEFAULT 'web'
    )
  `);
  try {
    const annotationColumns = new Set(db.prepare("PRAGMA table_info(document_annotations)").all().map((column) => column.name));
    if (!annotationColumns.has("photos_json")) db.exec("ALTER TABLE document_annotations ADD COLUMN photos_json TEXT");
  } catch (_error) { /* 表尚未创建时忽略 */ }
}

module.exports = { ensureDocumentSchema };
