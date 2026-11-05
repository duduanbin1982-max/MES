"use strict";

function ensureDocumentHistorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      version TEXT,
      issued_to TEXT,
      reason TEXT,
      operator_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_events_doc ON document_events(doc_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_document_events_action ON document_events(action, created_at);
  `);
}

function recordDocumentEvent(db, event) {
  try {
    db.prepare(`
      INSERT INTO document_events (
        doc_id, action, from_status, to_status, version, issued_to, reason, operator_id
      ) VALUES (
        @doc_id, @action, @from_status, @to_status, @version, @issued_to, @reason, @operator_id
      )
    `).run({
      doc_id: event.doc_id,
      action: event.action,
      from_status: event.from_status || null,
      to_status: event.to_status || null,
      version: event.version || null,
      issued_to: event.issued_to || null,
      reason: event.reason || null,
      operator_id: event.operator_id || null,
    });
  } catch (_error) {
    // History must not block the document lifecycle action.
  }
}

// 去掉尾部版本后缀：ZZ-001-A0 / ZZ-001_A1 → ZZ-001
function documentFamilyBase(code) {
  if (!code) return "";
  return String(code).replace(/[-_ ]?[A-Za-z]{1,3}\d{1,4}$/, "").trim();
}

function documentFamilyIds(db, current) {
  if (!current) return [];
  if (current.doc_code) {
    const base = documentFamilyBase(current.doc_code);
    if (base && base !== String(current.doc_code)) {
      return db.prepare("SELECT id FROM documents WHERE doc_code = ? OR doc_code LIKE ? OR doc_code LIKE ? ORDER BY id")
        .all(base, base + "-%", base + "_%")
        .map((row) => row.id);
    }
    return db.prepare("SELECT id FROM documents WHERE doc_code = ? ORDER BY id").all(current.doc_code).map((row) => row.id);
  }
  if (current.file_hash) {
    return db.prepare("SELECT id FROM documents WHERE file_hash = ? ORDER BY id").all(current.file_hash).map((row) => row.id);
  }
  return [current.id];
}

function documentEvents(db, documentIds) {
  if (!documentIds.length) return [];
  const placeholders = documentIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT e.*, u.full_name, u.username
    FROM document_events e
    LEFT JOIN users u ON u.id = e.operator_id
    WHERE e.doc_id IN (${placeholders})
    ORDER BY e.created_at DESC, e.id DESC
  `).all(...documentIds);
}

module.exports = { ensureDocumentHistorySchema, recordDocumentEvent, documentFamilyBase, documentFamilyIds, documentEvents };
