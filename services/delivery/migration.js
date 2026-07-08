"use strict";
// services/delivery/migration.js

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exception_cases (
      exception_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      owner_id INTEGER,
      owner_name TEXT,
      priority TEXT,
      due_at TEXT,
      closed_at TEXT,
      closed_by INTEGER,
      close_note TEXT,
      last_action TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS exception_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exception_id TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(exception_id) REFERENCES exception_cases(exception_id)
    );
    CREATE INDEX IF NOT EXISTS idx_exception_cases_status ON exception_cases(status);
    CREATE INDEX IF NOT EXISTS idx_exception_actions_exception ON exception_actions(exception_id);
    CREATE TABLE IF NOT EXISTS exception_escalation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      severity TEXT,
      escalate_after_hours REAL NOT NULL DEFAULT 24,
      escalate_to_role TEXT,
      notify_enabled INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS exception_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exception_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      channel TEXT DEFAULT 'feishu',
      title TEXT,
      content TEXT,
      target_role TEXT,
      result_json TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_exception_notifications_exception ON exception_notifications(exception_id);
  `);
}

module.exports = { runMigration };
