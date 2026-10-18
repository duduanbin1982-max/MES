"use strict";
// services/oee/migration.js
// OEE 表结构（幂等）。2026-10-18 P0-1：按 ISA-95 补三层时间基线与损失归类字段。

const { normalizeKey, countsAsLoss } = require("../../app/oee/lossCatalog");
const { createLogger } = require("../../app/logger");
const logger = createLogger("oeeMigration");

function addColumn(db, table, ddl) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch (_e) { /* 已存在 */ }
}

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

  // —— 三层时间基线（ISA-95）——
  addColumn(db, "oee_shift_log", "shift_minutes REAL");
  addColumn(db, "oee_shift_log", "planned_stop_minutes REAL DEFAULT 0");
  addColumn(db, "oee_shift_log", "fault_minutes REAL DEFAULT 0");
  addColumn(db, "oee_shift_log", "changeover_minutes REAL DEFAULT 0");
  addColumn(db, "oee_shift_log", "material_wait_minutes REAL DEFAULT 0");
  addColumn(db, "oee_shift_log", "idle_minutes REAL DEFAULT 0");
  addColumn(db, "oee_shift_log", "source TEXT DEFAULT 'manual'");

  // —— 损失归类与来源 ——
  addColumn(db, "oee_loss_events", "category_key TEXT");
  addColumn(db, "oee_loss_events", "source TEXT DEFAULT 'manual'");
  addColumn(db, "oee_loss_events", "counts_as_loss INTEGER DEFAULT 1");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oee_loss_category_key ON oee_loss_events(category_key);
    CREATE INDEX IF NOT EXISTS idx_oee_shift_instance_date ON oee_shift_log(equipment_instance_id, shift_date);
  `);

  // —— 回填：历史中文 loss_category → category_key（只补 NULL，幂等）——
  try {
    const pending = db.prepare("SELECT id, loss_category FROM oee_loss_events WHERE category_key IS NULL").all();
    if (pending.length) {
      const upd = db.prepare("UPDATE oee_loss_events SET category_key = ?, counts_as_loss = ? WHERE id = ?");
      const tx = db.transaction((rows) => {
        for (const row of rows) {
          const key = normalizeKey(row.loss_category);
          upd.run(key, countsAsLoss(key) ? 1 : 0, row.id);
        }
      });
      tx(pending);
      logger.info(`回填 loss category_key：${pending.length} 行`);
    }
  } catch (error) {
    logger.warn("loss category_key 回填失败（不影响启动）: " + error.message);
  }

  // —— 回填：老班次的班次时长（=(planned_minutes)+(planned_stop_minutes)）——
  try {
    const filled = db.prepare(
      "UPDATE oee_shift_log SET shift_minutes = COALESCE(planned_minutes, 0) + COALESCE(planned_stop_minutes, 0) WHERE shift_minutes IS NULL"
    ).run();
    if (filled.changes) logger.info(`回填 shift_minutes：${filled.changes} 行`);
  } catch (error) {
    logger.warn("shift_minutes 回填失败: " + error.message);
  }
}

module.exports = { runMigration };
