-- ============================================================
-- 009_fix_process_nodes_fk.sql
-- 修 process_nodes.bom_node_id 外键 (project_bom → instance_bom)
-- 12-step: 重建表
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE process_nodes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,
  bom_node_id INTEGER,
  operation_name TEXT NOT NULL,
  operation_type TEXT NOT NULL DEFAULT 'make',
  sequence INTEGER NOT NULL DEFAULT 1,
  estimated_hours REAL DEFAULT 0,
  required_workstation_id INTEGER,
  required_skill TEXT,
  required_materials TEXT,
  is_milestone INTEGER DEFAULT 0,
  phase_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  planned_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  auto_unblock INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
  FOREIGN KEY (parent_id) REFERENCES process_nodes(id),
  FOREIGN KEY (bom_node_id) REFERENCES instance_bom(id),
  FOREIGN KEY (required_workstation_id) REFERENCES workstations(id)
);

INSERT INTO process_nodes_new SELECT * FROM process_nodes;
DROP TABLE process_nodes;
ALTER TABLE process_nodes_new RENAME TO process_nodes;

CREATE INDEX IF NOT EXISTS idx_pn_instance ON process_nodes(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_pn_parent ON process_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_pn_status ON process_nodes(status);
CREATE INDEX IF NOT EXISTS idx_pn_bom ON process_nodes(bom_node_id);

COMMIT;
PRAGMA foreign_keys = ON;

SELECT '009 done' as status;
