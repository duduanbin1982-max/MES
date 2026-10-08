"use strict";
// db/schemaHelpers.js
// F9 (brooks-audit): centralize the idempotent ALTER TABLE ADD COLUMN pattern.
// Previously 18+ services each implemented their own addColumn wrapper; this
// consolidates the decision in one place. New services should use this helper.
// One-shot RENAME / CREATE INDEX migrations remain in their original files.
"use strict";

const debug = require("node:util").debuglog("schema");

/**
 * Idempotently add a column to a table. Safe to call on existing schemas
 * where the column may already be present.
 *
 * @param {object} db  better-sqlite3 database instance
 * @param {string} table  table name (caller-validated; do not pass user input)
 * @param {string} colDef  column definition, e.g. "assigned_to INTEGER REFERENCES users(id)"
 * @returns {boolean}  true if column was added, false if it already existed
 */
function addColumnIfMissing(db, table, colDef) {
  try {
    db.prepare("ALTER TABLE " + table + " ADD COLUMN " + colDef).run();
    debug("added column", table, colDef);
    return true;
  } catch (err) {
    // SQLite throws on duplicate column. Treat as success (idempotent).
    if (/duplicate column|already exists/i.test(String(err && err.message))) {
      return false;
    }
    throw err;
  }
}

module.exports = { addColumnIfMissing };
