"use strict";
// DDL + helper for PRAGMA table_info lookup (with ALLOWED_TABLES whitelist).

const ALLOWED_TABLES = new Set(["ai_models", "ai_predictions"]);

function columnNames(db, table) {
  if (!ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, definition) {
  if (!columnNames(db, table).has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
}

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_code TEXT NOT NULL,
      model_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      device_id INTEGER,
      point_id INTEGER,
      algorithm TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'candidate',
      training_rows INTEGER NOT NULL DEFAULT 0,
      validation_rows INTEGER NOT NULL DEFAULT 0,
      train_from TEXT,
      train_to TEXT,
      feature_schema TEXT NOT NULL,
      parameters TEXT NOT NULL,
      metrics TEXT NOT NULL,
      data_quality TEXT,
      artifact_hash TEXT,
      trained_by INTEGER,
      trained_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(model_code, version)
    );

    CREATE TABLE IF NOT EXISTS ai_training_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER,
      model_code TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      training_rows INTEGER NOT NULL DEFAULT 0,
      validation_rows INTEGER NOT NULL DEFAULT 0,
      mae REAL,
      rmse REAL,
      r2 REAL,
      skill_vs_baseline REAL,
      message TEXT,
      FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_models_target ON ai_models(device_id, point_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_training_runs_time ON ai_training_runs(started_at DESC);
  `);
  addColumn(db, "ai_predictions", "model_id", "model_id INTEGER");
  addColumn(db, "ai_models", "training_source", "training_source TEXT NOT NULL DEFAULT 'production'");
}

module.exports = { runMigration, columnNames, addColumn, ALLOWED_TABLES };
