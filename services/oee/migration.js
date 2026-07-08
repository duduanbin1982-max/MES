"use strict";

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oee_loss_events (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      loss_category TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      duration_minutes REAL,
      description TEXT,
      reported_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS oee_shift_log (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      shift_date TEXT,
      shift_name TEXT,
      planned_minutes REAL,
      operating_minutes REAL,
      ideal_cycle_time REAL,
      total_output INTEGER,
      good_output INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oee_loss_instance ON oee_loss_events(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_oee_loss_time ON oee_loss_events(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_oee_shift_instance ON oee_shift_log(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_oee_shift_date ON oee_shift_log(shift_date);
  `);
}

module.exports = { runMigration };
