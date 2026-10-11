"use strict";
// services/supplierCollaboration/schema.js
// 表结构: incoming_inspections / outsourcing_orders / supplier_score_snapshots。
// (原 services/supplierCollaborationService.js 第 10-82 行)
//
// ALLOWED_TABLES 白名单在这里真正生效：P1-4 (2026-10-08) 曾在原文件里声明过
// 这个 Set 但没有接进 addColumn，本轮拆分时补上，与 bom/equipment/delivery 等
// 其它 7 个文件保持一致。

const ALLOWED_TABLES = new Set(["incoming_inspections", "purchase_receiving"]);

function addColumn(db, table, column, definition) {
  if (!ALLOWED_TABLES.has(table)) throw new Error("Invalid table name: " + table);
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incoming_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER,
      supplier_id INTEGER,
      material_id INTEGER,
      lot_no TEXT,
      inspection_no TEXT UNIQUE,
      inspection_date TEXT DEFAULT (datetime('now')),
      inspector_id INTEGER,
      sample_qty REAL DEFAULT 0,
      defect_qty REAL DEFAULT 0,
      result TEXT DEFAULT 'pending',
      defect_desc TEXT,
      disposition TEXT,
      ncr_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_incoming_supplier ON incoming_inspections(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_po ON incoming_inspections(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_result ON incoming_inspections(result);

    CREATE TABLE IF NOT EXISTS outsourcing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outsource_no TEXT UNIQUE,
      supplier_id INTEGER NOT NULL,
      equipment_instance_id INTEGER,
      work_order_id INTEGER,
      item_name TEXT NOT NULL,
      process_name TEXT,
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      progress_pct REAL DEFAULT 0,
      status TEXT DEFAULT 'planned',
      quality_status TEXT DEFAULT 'pending',
      contract_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsource_supplier ON outsourcing_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_outsource_status ON outsourcing_orders(status);

    CREATE TABLE IF NOT EXISTS supplier_score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      delivery_score REAL,
      quality_score REAL,
      service_score REAL,
      total_score REAL,
      grade TEXT,
      metrics_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(supplier_id, period)
    );
  `);
  addColumn(db, "incoming_inspections", "receiving_id", "INTEGER");
  addColumn(db, "purchase_receiving", "material_lot_id", "INTEGER");
  addColumn(db, "purchase_receiving", "inventory_id", "INTEGER");
  addColumn(db, "purchase_receiving", "inspection_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_incoming_receiving ON incoming_inspections(receiving_id)");
}

module.exports = { ensureSchema, addColumn, ALLOWED_TABLES };
