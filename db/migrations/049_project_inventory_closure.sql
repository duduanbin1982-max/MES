-- 2026-11-16 项目库存关闭与结转
CREATE TABLE IF NOT EXISTS project_inventory_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  closed_by INTEGER,
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_items INTEGER NOT NULL DEFAULT 0,
  total_quantity REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_inventory_closure_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  closure_id INTEGER NOT NULL,
  inventory_id INTEGER,
  material_id INTEGER NOT NULL,
  material_lot_id INTEGER,
  quantity REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  disposition TEXT NOT NULL,
  notes TEXT,
  FOREIGN KEY (closure_id) REFERENCES project_inventory_closures(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pic_equipment ON project_inventory_closures(equipment_instance_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_pici_closure ON project_inventory_closure_items(closure_id);
