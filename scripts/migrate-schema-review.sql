-- P1-1: 数据库 schema 全面 review 修复
-- 52 张表, 发现 18 个问题, 分 6 类修复
-- Author: 三狗子 | Date: 2026-06-25

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- ========================================
-- 1. CRITICAL: 错误外键引用修复
-- ========================================

-- 1a. process_nodes.bom_node_id → instance_bom_v22 (表不存在!) → instance_bom
-- SQLite 不支持 ALTER DROP CONSTRAINT, 需重建表
-- 但 SQLite 的外键是表级定义, 无法直接修改。采用验证+重建策略:
-- 先检查 instance_bom_v22 是否存在, 若不存在则用 instance_bom 替换

-- 1b. 由于 SQLite 限制, 对 process_nodes 做重建
CREATE TABLE IF NOT EXISTS process_nodes_new (
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
  subsystem_id INTEGER,
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES process_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (bom_node_id) REFERENCES instance_bom(id) ON DELETE SET NULL,
  FOREIGN KEY (required_workstation_id) REFERENCES workstations(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subsystem_id) REFERENCES equipment_subsystems(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO process_nodes_new SELECT * FROM process_nodes;
DROP TABLE process_nodes;
ALTER TABLE process_nodes_new RENAME TO process_nodes;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_pn_instance ON process_nodes(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_pn_parent ON process_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_pn_status ON process_nodes(status);
CREATE INDEX IF NOT EXISTS idx_pn_bom ON process_nodes(bom_node_id);
CREATE INDEX IF NOT EXISTS idx_pn_subsystem ON process_nodes(subsystem_id);

-- ========================================
-- 2. 缺失外键补充
-- ========================================

-- 2a. material_movements.project_id → projects.id
-- SQLite 不支持 ALTER ADD CONSTRAINT, 重建
CREATE TABLE IF NOT EXISTS material_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_lot_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  from_location TEXT,
  to_location TEXT,
  work_order_id INTEGER,
  project_id INTEGER,
  operator_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (material_lot_id) REFERENCES material_lots(id) ON DELETE CASCADE,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO material_movements_new SELECT * FROM material_movements;
DROP TABLE material_movements;
ALTER TABLE material_movements_new RENAME TO material_movements;

CREATE INDEX IF NOT EXISTS idx_mm_lot ON material_movements(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_mm_type ON material_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_mm_wo ON material_movements(work_order_id);
CREATE INDEX IF NOT EXISTS idx_mm_project ON material_movements(project_id);

-- 2b. process_dependencies.equipment_instance_id → equipment_instances.id
CREATE TABLE IF NOT EXISTS process_dependencies_new (
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

INSERT OR IGNORE INTO process_dependencies_new SELECT * FROM process_dependencies;
DROP TABLE process_dependencies;
ALTER TABLE process_dependencies_new RENAME TO process_dependencies;

CREATE INDEX IF NOT EXISTS idx_pd_pred ON process_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_pd_succ ON process_dependencies(successor_id);

-- ========================================
-- 3. 清理重复索引
-- ========================================

-- 3a. work_orders: idx_wo_status / idx_work_orders_status (重复)
DROP INDEX IF EXISTS idx_work_orders_status;
-- 3b. work_orders: idx_wo_instance / idx_work_orders_project (重复)
DROP INDEX IF EXISTS idx_work_orders_project;
-- 3c. equipment_instances: idx_ei_model / idx_equipment_instances_model (重复)
DROP INDEX IF EXISTS idx_equipment_instances_model;
-- 3d. instance_bom: idx_documents_project (命名错误, 且与 idx_bom_instance 重复)
DROP INDEX IF EXISTS idx_documents_project;
-- 3e. material_movements duplicates (已重建, 旧索引随 DROP TABLE 消失)
-- 3f. po_lines: idx_pol_po / idx_po_lines_po (重复) + idx_pol_material / idx_po_lines_material (重复)
DROP INDEX IF EXISTS idx_po_lines_po;
DROP INDEX IF EXISTS idx_po_lines_material;
-- 3g. instance_milestones: idx_milestones_project / idx_instance_milestones_instance (重复)
DROP INDEX IF EXISTS idx_milestones_project;
-- 3h. equipment_instances: idx_equipment_instances_code / autoindex (重复)
DROP INDEX IF EXISTS idx_equipment_instances_code;

-- ========================================
-- 4. 缺失业务索引补充
-- ========================================

-- 项目体系 (高频查询, 无一索引)
CREATE INDEX IF NOT EXISTS idx_project_bom_project ON project_bom(project_id);
CREATE INDEX IF NOT EXISTS idx_project_eco_project ON project_eco(project_id);
CREATE INDEX IF NOT EXISTS idx_project_eco_status ON project_eco(status);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_project_milestones_status ON project_milestones(status);
CREATE INDEX IF NOT EXISTS idx_project_specs_project ON project_specs(project_id);

-- ECO 实例
CREATE INDEX IF NOT EXISTS idx_instance_eco_instance ON instance_eco(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_eco_status ON instance_eco(status);

-- 规格/里程碑
CREATE INDEX IF NOT EXISTS idx_instance_specs_instance ON instance_specs(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_milestones_status ON instance_milestones(status);

-- 反馈/现场
CREATE INDEX IF NOT EXISTS idx_feedback_instance ON feedback(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_field_service_status ON field_service(status);

-- NDT
CREATE INDEX IF NOT EXISTS idx_ndt_weld ON ndt_records(weld_record_id);

-- 工单操作
CREATE INDEX IF NOT EXISTS idx_wo_ops_operator ON work_order_operations(operator_id);

-- 关键件
CREATE INDEX IF NOT EXISTS idx_key_components_material ON key_components(material_id);

-- 供应商
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

-- 工作流定义
CREATE INDEX IF NOT EXISTS idx_workflow_instances_created ON workflow_instances(created_at);

-- ========================================
-- 5. ON DELETE 策略修正
-- ========================================

-- instance_eco.equipment_instance_id: 改为 CASCADE
-- (需要重建, 因为 SQLite 不支持 ALTER CONSTRAINT)
CREATE TABLE IF NOT EXISTS instance_eco_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  eco_no TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  affected_scope TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  effective_date TEXT,
  closed_date TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO instance_eco_new SELECT * FROM instance_eco;
DROP TABLE instance_eco;
ALTER TABLE instance_eco_new RENAME TO instance_eco;

CREATE INDEX IF NOT EXISTS idx_instance_eco_instance ON instance_eco(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_eco_status ON instance_eco(status);

-- feedback.equipment_instance_id: 改为 CASCADE
CREATE TABLE IF NOT EXISTS feedback_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_instance_id INTEGER NOT NULL,
  feedback_type TEXT,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'medium',
  reported_by INTEGER,
  reported_date TEXT,
  status TEXT DEFAULT 'open',
  resolution TEXT,
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO feedback_new SELECT * FROM feedback;
DROP TABLE feedback;
ALTER TABLE feedback_new RENAME TO feedback;

CREATE INDEX IF NOT EXISTS idx_feedback_instance ON feedback(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);

-- ========================================
-- 6. 数据完整性约束
-- ========================================

-- 6a. inventory.quantity: 确保 >= 0
CREATE TRIGGER IF NOT EXISTS trg_inventory_qty_nonnegative
BEFORE UPDATE ON inventory
WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'inventory.quantity 不能为负');
END;

-- 6b. materials: 确保 material_code UNIQUE (已有)
-- 6c. 确保 safety_stock >= 0
CREATE TRIGGER IF NOT EXISTS trg_materials_safety_stock_nonnegative
BEFORE UPDATE ON materials
WHEN NEW.safety_stock < 0
BEGIN
  SELECT RAISE(ABORT, 'materials.safety_stock 不能为负');
END;

COMMIT;
PRAGMA foreign_keys=ON;
