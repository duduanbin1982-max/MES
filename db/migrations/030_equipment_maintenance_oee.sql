-- 2026-11-10 设备台账第二阶段：车间设备维保 / OEE / 状态履历
-- @ensure-column equipment original_value REAL
-- @ensure-column equipment depreciation_method TEXT
-- @ensure-column equipment depreciation_years INTEGER
-- @ensure-column equipment residual_rate REAL
-- @ensure-column equipment commission_date TEXT
-- @ensure-column equipment retired_at TEXT
-- @ensure-column equipment retire_reason TEXT
-- @ensure-column equipment updated_at TEXT

CREATE TABLE IF NOT EXISTS equipment_maintenance_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  maintenance_type TEXT NOT NULL DEFAULT 'periodic',
  frequency_days INTEGER,
  next_due_date TEXT,
  last_done_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  assigned_to INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_maint_plans_equipment ON equipment_maintenance_plans(equipment_id, next_due_date);

CREATE TABLE IF NOT EXISTS equipment_maintenance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  plan_id INTEGER,
  performed_by INTEGER,
  performed_at TEXT NOT NULL,
  hours_spent REAL,
  findings TEXT,
  actions_taken TEXT,
  parts_replaced TEXT,
  next_due_at TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_maint_logs_equipment ON equipment_maintenance_logs(equipment_id, performed_at);

CREATE TABLE IF NOT EXISTS equipment_oee_shift_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  shift_date TEXT NOT NULL,
  shift_name TEXT,
  planned_minutes REAL DEFAULT 0,
  operating_minutes REAL DEFAULT 0,
  ideal_cycle_time REAL DEFAULT 0,
  total_output REAL DEFAULT 0,
  good_output REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_oee_equipment_date ON equipment_oee_shift_log(equipment_id, shift_date);

CREATE TABLE IF NOT EXISTS equipment_status_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_status_logs_equipment ON equipment_status_logs(equipment_id, changed_at);
