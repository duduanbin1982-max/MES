"use strict";

const { ensureDocumentHistorySchema } = require("./history");

function ensureDocumentSchema(db) {
  ensureDocumentHistorySchema(db);
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
