"use strict";
// services/cost/projectCostEntries/schema.js
// project_cost_entries 建表 + 4 个索引 + 旧表迁移（含 CHECK 约束升级）。
// (原 services/cost/projectCostEntries.js 第 19-85 行)
// DDL 字符串保持逐字不变 —— service-schema 指纹依赖它。

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      bom_node_id INTEGER,
      work_order_id INTEGER,
      cost_type TEXT NOT NULL CHECK (cost_type IN ('material','labor','outsourcing','depreciation','rework','quality_loss')),
      source_type TEXT,
      source_ref TEXT,
      description TEXT NOT NULL,
      vendor TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      occurred_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','void')),
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_project_cost_entries_instance ON project_cost_entries(equipment_instance_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_project_cost_entries_type ON project_cost_entries(cost_type, status);
    CREATE INDEX IF NOT EXISTS idx_project_cost_entries_bom ON project_cost_entries(bom_node_id);
    CREATE INDEX IF NOT EXISTS idx_project_cost_entries_work_order ON project_cost_entries(work_order_id);
  `);

  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_cost_entries'").get()?.sql || "";
  if (tableSql && !tableSql.includes("'material'")) {
    const legacyName = "project_cost_entries_legacy_" + Date.now();
    db.exec(`ALTER TABLE project_cost_entries RENAME TO ${legacyName};`);
    db.exec(`
      CREATE TABLE project_cost_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_instance_id INTEGER NOT NULL,
        bom_node_id INTEGER,
        work_order_id INTEGER,
        cost_type TEXT NOT NULL CHECK (cost_type IN ('material','labor','outsourcing','depreciation','rework','quality_loss')),
        source_type TEXT,
        source_ref TEXT,
        description TEXT NOT NULL,
        vendor TEXT,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        occurred_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','void')),
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
      INSERT INTO project_cost_entries (
        id, equipment_instance_id, bom_node_id, work_order_id, cost_type, source_type, source_ref,
        description, vendor, amount, currency, occurred_on, status, notes, created_by, created_at, updated_at, deleted_at
      )
      SELECT id, equipment_instance_id, bom_node_id, work_order_id, cost_type, source_type, source_ref,
             description, vendor, amount, currency, occurred_on, status, notes, created_by, created_at, updated_at, deleted_at
        FROM ${legacyName};
      CREATE INDEX IF NOT EXISTS idx_project_cost_entries_instance ON project_cost_entries(equipment_instance_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_project_cost_entries_type ON project_cost_entries(cost_type, status);
      CREATE INDEX IF NOT EXISTS idx_project_cost_entries_bom ON project_cost_entries(bom_node_id);
      CREATE INDEX IF NOT EXISTS idx_project_cost_entries_work_order ON project_cost_entries(work_order_id);
    `);
  }
}

module.exports = { ensureSchema };
