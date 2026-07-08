"use strict";
// services/fieldServiceSchema.js
// Shared schema owner for field service, spare parts and maintenance planning.

function ensureFieldServiceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      plan_code TEXT,
      plan_name TEXT,
      maintenance_type TEXT DEFAULT 'routine',
      frequency_days INTEGER DEFAULT 90,
      next_due_date TEXT,
      last_done_date TEXT,
      status TEXT DEFAULT 'pending',
      assigned_to INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER,
      equipment_instance_id INTEGER,
      performed_by INTEGER,
      performed_at TEXT DEFAULT (datetime('now')),
      hours_spent REAL,
      findings TEXT,
      actions_taken TEXT,
      parts_replaced TEXT,
      next_due_date TEXT,
      status TEXT DEFAULT 'completed',
      FOREIGN KEY (plan_id) REFERENCES maintenance_plans(id),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
      FOREIGN KEY (performed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS spare_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      part_code TEXT,
      part_name TEXT NOT NULL,
      part_type TEXT DEFAULT 'mechanical',
      quantity INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      unit TEXT DEFAULT 'pcs',
      location TEXT,
      supplier TEXT,
      unit_price REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_spare_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      spare_part_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (plan_id) REFERENCES maintenance_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (spare_part_id) REFERENCES spare_parts(id) ON DELETE CASCADE,
      UNIQUE(plan_id, spare_part_id)
    );

    CREATE TABLE IF NOT EXISTS breakdown_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      report_code TEXT UNIQUE,
      fault_type TEXT NOT NULL,
      fault_desc TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      reported_by INTEGER,
      reported_at TEXT DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
      FOREIGN KEY (reported_by) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id),
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      checklist_name TEXT NOT NULL,
      check_type TEXT NOT NULL DEFAULT 'daily',
      items_json TEXT NOT NULL DEFAULT '[]',
      assigned_to INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_breakdown_equip ON breakdown_reports(equipment_instance_id, status);
    CREATE INDEX IF NOT EXISTS idx_sp_inst ON spare_parts(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_mp_inst ON maintenance_plans(equipment_instance_id);
    CREATE INDEX IF NOT EXISTS idx_mp_status ON maintenance_plans(status);
    CREATE INDEX IF NOT EXISTS idx_mp_due ON maintenance_plans(next_due_date);
  `);
}

module.exports = { ensureFieldServiceSchema };
