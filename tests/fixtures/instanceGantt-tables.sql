-- tests/fixtures/instanceGantt-tables.sql
-- 由 .tmp/gen-instance-gantt-fixture.js 从生产库 data/mes.db 导出（仅表结构）。
-- 重新生成：node .tmp/gen-instance-gantt-fixture.js
CREATE TABLE "equipment_instances" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_code TEXT UNIQUE NOT NULL,
  instance_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  site_location TEXT,
  contract_no TEXT,
  equipment_model_id INTEGER REFERENCES equipment_models(id),
  start_date TEXT,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'design',
  progress_pct REAL DEFAULT 0,
  contract_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  lifecycle_stage TEXT,
  serial_no TEXT
, contract_amount_unit TEXT NOT NULL DEFAULT 'wan'
  CHECK (contract_amount_unit IN ('yuan', 'wan')), project_no TEXT, archive_status TEXT DEFAULT 'active', archived_at TEXT, archived_by INTEGER, frozen_at TEXT, frozen_by INTEGER, freeze_snapshot TEXT, source_template_id INTEGER);

CREATE INDEX idx_ei_customer ON equipment_instances(customer_name) WHERE customer_name IS NOT NULL;

CREATE INDEX idx_ei_model ON equipment_instances(equipment_model_id) WHERE equipment_model_id IS NOT NULL;

CREATE INDEX idx_ei_status ON equipment_instances(status);

CREATE INDEX idx_equipment_instances_project_no ON equipment_instances(project_no);

CREATE INDEX idx_equipment_instances_archive_status ON equipment_instances(archive_status);

CREATE TABLE "process_nodes" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,
  bom_node_id INTEGER,
  operation_name TEXT NOT NULL,
  operation_type TEXT DEFAULT 'make',
  sequence INTEGER DEFAULT 1,
  estimated_hours REAL DEFAULT 0,
  required_workstation_id INTEGER,
  required_skill TEXT,
  required_materials TEXT,
  is_milestone INTEGER DEFAULT 0,
  phase_code TEXT,
  status TEXT DEFAULT 'pending',
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  planned_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  auto_unblock INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  assigned_to INTEGER,
  subsystem_id INTEGER, operation_template_id INTEGER, required_position_code TEXT, worker_count INTEGER DEFAULT 1, qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0,
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES process_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (bom_node_id) REFERENCES instance_bom(id) ON DELETE SET NULL,
  FOREIGN KEY (required_workstation_id) REFERENCES workstations(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subsystem_id) REFERENCES equipment_subsystems(id) ON DELETE SET NULL
);

CREATE INDEX idx_pn_instance ON process_nodes(equipment_instance_id);

CREATE INDEX idx_pn_parent ON process_nodes(parent_id);

CREATE INDEX idx_pn_status ON process_nodes(status);

CREATE INDEX idx_pn_bom ON process_nodes(bom_node_id);

CREATE INDEX idx_pn_subsystem ON process_nodes(subsystem_id);

CREATE INDEX idx_process_nodes_template ON process_nodes(operation_template_id);

CREATE TABLE workstations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  workshop TEXT,                               -- 切割下料/铆接/焊接/装配
  capacity_per_day INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, station_type TEXT DEFAULT 'general', status TEXT DEFAULT 'available', capability_tags TEXT, required_skills TEXT, max_workers INTEGER DEFAULT 1, location TEXT, shift TEXT DEFAULT 'day', notes TEXT);

CREATE INDEX idx_workstations_station_type ON workstations(station_type);

CREATE INDEX idx_workstations_status ON workstations(status);

CREATE TABLE "equipment_subsystems" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,                   -- cutter_head / shield_body / ...
  name_zh TEXT NOT NULL,                       -- 刀盘
  name_en TEXT,                                -- Cutter Head
  sequence INTEGER NOT NULL,                   -- 1-9
  description TEXT
, equipment_type_id INTEGER REFERENCES equipment_types(id));

CREATE INDEX idx_equipment_subsystems_type ON equipment_subsystems(equipment_type_id);

CREATE TABLE "process_dependencies" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  predecessor_id INTEGER NOT NULL,
  successor_id INTEGER NOT NULL,
  dep_type TEXT DEFAULT 'FS',
  lag_hours REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (predecessor_id) REFERENCES process_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_id) REFERENCES process_nodes(id) ON DELETE CASCADE
);

CREATE INDEX idx_pd_pred ON process_dependencies(predecessor_id);

CREATE INDEX idx_pd_succ ON process_dependencies(successor_id);
