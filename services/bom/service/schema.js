"use strict";

// P0: ALLOWED_TABLES whitelist (callers verified 2026-10-08: inventory, material_lots, purchase_order_items, purchase_orders, suppliers, users, shortage_cases, instance_bom)
const ALLOWED_TABLES = new Set([
  "inventory",
  "material_lots",
  "purchase_order_items",
  "purchase_orders",
  "suppliers",
  "users",
  "shortage_cases",
  "instance_bom",
  "bom_version_releases",
]);

function tableColumns(db, tableName) {
  if (!ALLOWED_TABLES.has(tableName)) throw new Error("Invalid table name: " + tableName);
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  } catch (_error) {
    return new Set();
  }
}

function hasColumns(db, tableName, columns) {
  const cols = tableColumns(db, tableName);
  return columns.every((col) => cols.has(col));
}

function addColumnIfMissing(db, tableName, columnName, ddl) {
  const cols = tableColumns(db, tableName);
  if (!cols.has(columnName)) db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`).run();
}

function ensureBomStructureColumns(db) {
  try {
    addColumnIfMissing(db, "instance_bom", "node_type", "node_type TEXT");
    addColumnIfMissing(db, "instance_bom", "level_code", "level_code TEXT");
    addColumnIfMissing(db, "instance_bom", "sort_order", "sort_order INTEGER DEFAULT 0");
    addColumnIfMissing(db, "instance_bom", "view_flags", "view_flags TEXT");
    // 2026-11-07（BOM 审计 B-8）：成本增加人工/制造费用
    addColumnIfMissing(db, "instance_bom", "labor_cost", "labor_cost REAL DEFAULT 0");
    addColumnIfMissing(db, "instance_bom", "manufacturing_cost", "manufacturing_cost REAL DEFAULT 0");
    // 2026-11-07（EBOM/MBOM）：BOM 类型与来源 EBOM 行
    addColumnIfMissing(db, "instance_bom", "bom_type", "bom_type TEXT DEFAULT 'EBOM'");
    addColumnIfMissing(db, "instance_bom", "source_bom_id", "source_bom_id INTEGER");
    db.prepare(`CREATE TABLE IF NOT EXISTS bom_version_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'released',
      eco_id INTEGER,
      effective_from TEXT,
      effective_to TEXT,
      row_count INTEGER DEFAULT 0,
      snapshot_json TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      released_at TEXT,
      obsolete_at TEXT,
      UNIQUE(equipment_instance_id, version)
    )`).run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_instance_bom_parent_sort ON instance_bom(equipment_instance_id, parent_id, sort_order, id)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_instance_bom_level_code ON instance_bom(equipment_instance_id, level_code)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_instance_bom_node_type ON instance_bom(equipment_instance_id, node_type)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_instance_bom_type ON instance_bom(equipment_instance_id, bom_type)").run();
    addColumnIfMissing(db, "bom_version_releases", "bom_type", "bom_type TEXT DEFAULT 'EBOM'");
    addColumnIfMissing(db, "bom_version_releases", "baseline_type", "baseline_type TEXT");
  } catch (_error) {
    // instance_bom may not exist in isolated unit tests; callers using BOM routes create it before production use.
  }
}

module.exports = {
  tableColumns,
  hasColumns,
  addColumnIfMissing,
  ensureBomStructureColumns,
};
