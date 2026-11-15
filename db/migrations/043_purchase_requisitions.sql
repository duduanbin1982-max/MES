-- 2026-11-15 低库存自动补货：采购申请单
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  requested_by INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  priority TEXT,
  suggested_date TEXT,
  notes TEXT,
  FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pri_pr ON purchase_requisition_items(pr_id);
CREATE INDEX IF NOT EXISTS idx_pri_material ON purchase_requisition_items(material_id);
