// services/purchase/trackingStore.js
"use strict";

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function ensurePurchaseTracking(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER,
      source_type TEXT DEFAULT 'purchase_order',
      source_ref_id INTEGER,
      item_name TEXT,
      supplier TEXT,
      order_date TEXT,
      planned_delivery TEXT,
      actual_delivery TEXT,
      delay_days INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      urgent_tags TEXT,
      remarks TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      equipment_instance_id INTEGER,
      material_id INTEGER,
      purchase_request_no TEXT,
      linked_shortage_count INTEGER DEFAULT 0,
      linked_work_order_count INTEGER DEFAULT 0,
      linked_shortage_ids TEXT,
      linked_work_order_ids TEXT,
      risk_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const cols = new Set(db.prepare("PRAGMA table_info(purchase_tracking)").all().map((row) => row.name));
  if (!cols.has("source_type")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN source_type TEXT DEFAULT 'purchase_order'").run();
  if (!cols.has("source_ref_id")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN source_ref_id INTEGER").run();
  if (!cols.has("owner_id")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN owner_id INTEGER").run();
  if (!cols.has("owner_name")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN owner_name TEXT").run();
  if (!cols.has("equipment_instance_id")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN equipment_instance_id INTEGER").run();
  if (!cols.has("material_id")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN material_id INTEGER").run();
  if (!cols.has("purchase_request_no")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN purchase_request_no TEXT").run();
  if (!cols.has("linked_shortage_count")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN linked_shortage_count INTEGER DEFAULT 0").run();
  if (!cols.has("linked_work_order_count")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN linked_work_order_count INTEGER DEFAULT 0").run();
  if (!cols.has("linked_shortage_ids")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN linked_shortage_ids TEXT").run();
  if (!cols.has("linked_work_order_ids")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN linked_work_order_ids TEXT").run();
  if (!cols.has("risk_level")) db.prepare("ALTER TABLE purchase_tracking ADD COLUMN risk_level TEXT").run();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pt_status ON purchase_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_pt_delay ON purchase_tracking(delay_days);
    CREATE INDEX IF NOT EXISTS idx_pt_source ON purchase_tracking(source_type, source_ref_id);
    CREATE INDEX IF NOT EXISTS idx_pt_instance ON purchase_tracking(equipment_instance_id, status);
  `);
}

module.exports = {
  tableExists,
  ensurePurchaseTracking,
};
