-- ============================================================
-- 004_cleanup_legacy_columns.sql
-- 清理 migration 003 漏掉的旧列 tbm_model_id
-- SQLite 12-step: rebuild table without legacy FK
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1) 建新表（无 tbm_model_id）
CREATE TABLE equipment_instances_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_code TEXT UNIQUE NOT NULL,
  instance_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  site_location TEXT,
  contract_no TEXT,
  equipment_model_id INTEGER REFERENCES equipment_models(id),
  start_date TEXT,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'design',
  progress_pct REAL DEFAULT 0,
  contract_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lifecycle_stage TEXT,
  serial_no TEXT
);

-- 2) 拷数据（跳过 tbm_model_id）
INSERT INTO equipment_instances_new
  (id, instance_code, instance_name, customer_name, customer_contact, site_location,
   contract_no, equipment_model_id, start_date, planned_start, planned_end,
   actual_start, actual_end, status, progress_pct, contract_amount, notes,
   created_at, updated_at, lifecycle_stage, serial_no)
SELECT
  id, instance_code, instance_name, customer_name, customer_contact, site_location,
  contract_no, COALESCE(equipment_model_id, tbm_model_id), start_date, planned_start, planned_end,
  actual_start, actual_end, status, progress_pct, contract_amount, notes,
  created_at, updated_at, lifecycle_stage, serial_no
FROM equipment_instances;

-- 3) 删旧表
DROP TABLE equipment_instances;

-- 4) 改名
ALTER TABLE equipment_instances_new RENAME TO equipment_instances;

-- 5) 重建索引
CREATE INDEX IF NOT EXISTS idx_equipment_instances_model ON equipment_instances(equipment_model_id);
CREATE INDEX IF NOT EXISTS idx_equipment_instances_code ON equipment_instances(instance_code);

COMMIT;
PRAGMA foreign_keys = ON;

SELECT '004 done' as status;