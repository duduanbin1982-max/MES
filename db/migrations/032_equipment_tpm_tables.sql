-- 2026-11-10 设备与维护：车间设备点检/故障/备件表（与项目装备旧表分离）
CREATE TABLE IF NOT EXISTS equipment_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER,
  checklist_name TEXT NOT NULL,
  check_type TEXT NOT NULL DEFAULT 'daily',
  items_json TEXT NOT NULL DEFAULT '[]',
  assigned_to INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  last_executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_checklists_equipment ON equipment_checklists(equipment_id, status);

CREATE TABLE IF NOT EXISTS equipment_breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  report_code TEXT UNIQUE,
  fault_type TEXT NOT NULL,
  fault_desc TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  reported_by INTEGER,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER,
  repair_start TEXT,
  repair_end TEXT,
  downtime_hours REAL,
  root_cause TEXT,
  repair_actions TEXT,
  parts_used TEXT,
  repair_cost REAL,
  verified_by INTEGER,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_breakdowns_equipment ON equipment_breakdowns(equipment_id, status);

CREATE TABLE IF NOT EXISTS equipment_spare_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER,
  part_code TEXT,
  part_name TEXT NOT NULL,
  part_type TEXT NOT NULL DEFAULT 'mechanical',
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  unit TEXT NOT NULL DEFAULT 'pcs',
  location TEXT,
  supplier TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_spare_parts_equipment ON equipment_spare_parts(equipment_id);
