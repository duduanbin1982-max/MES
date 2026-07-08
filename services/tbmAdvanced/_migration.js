// services/tbmAdvanced/_migration.js
// TBM 增强模块: 数据库迁移 (5 张表) — 从 tbmAdvanced.js 拆分
'use strict';

const { ensurePurchaseTracking } = require('../purchase/trackingStore');

function runMigration(db) {
  ensurePurchaseTracking(db);
  db.exec(`
    -- 1. 关键件管理
    CREATE TABLE IF NOT EXISTS critical_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      part_code TEXT NOT NULL,
      part_name TEXT NOT NULL,
      part_type TEXT DEFAULT 'mechanical',
      drawing_no TEXT,
      spec TEXT,
      supplier TEXT,
      manufacturing_standard TEXT,
      inspection_points TEXT DEFAULT '[]',
      risk_level TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS critical_part_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      cert_type TEXT NOT NULL,
      cert_no TEXT,
      issued_by TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      file_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (part_id) REFERENCES critical_parts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS supervision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      part_id INTEGER,
      log_date TEXT NOT NULL,
      inspector TEXT,
      location TEXT,
      content TEXT,
      photos TEXT DEFAULT '[]',
      issues TEXT,
      status TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (part_id) REFERENCES critical_parts(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cp_inst ON critical_parts(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_sl_part ON supervision_logs(part_id);

    -- 2. 采购跟催由 services/purchase/trackingStore.js 统一迁移

    -- 3. 项目看板
    CREATE TABLE IF NOT EXISTS contract_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      milestone_name TEXT NOT NULL,
      planned_date TEXT,
      actual_date TEXT,
      payment_pct REAL DEFAULT 0,
      payment_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      sequence INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id)
    );
    CREATE TABLE IF NOT EXISTS project_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER,
      amount REAL NOT NULL,
      received_date TEXT,
      payment_method TEXT,
      voucher_no TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cm_inst ON contract_milestones(equipment_instance_id);

    -- 4. 客户验收
    CREATE TABLE IF NOT EXISTS acceptance_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      checklist_name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      inspector TEXT,
      customer_rep TEXT,
      result TEXT,
      issues TEXT,
      sign_date TEXT,
      signature_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_acl_inst ON acceptance_checklists(equipment_instance_id);

    -- 5. 故障知识库
    CREATE TABLE IF NOT EXISTS fault_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_type_id INTEGER,
      fault_code TEXT NOT NULL,
      fault_name TEXT NOT NULL,
      symptom TEXT,
      root_cause TEXT,
      solution TEXT,
      spare_parts TEXT DEFAULT '[]',
      difficulty TEXT DEFAULT 'medium',
      frequency TEXT DEFAULT 'occasional',
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fk_type ON fault_knowledge(equipment_type_id);
    CREATE INDEX IF NOT EXISTS idx_fk_diff ON fault_knowledge(difficulty);
  `);
}

module.exports = { runMigration };
