-- ============================================================
-- 002_tbm_phase1.sql
-- TBM-MES v2 Phase 1 Schema (25 tables)
-- Author: 三狗子
-- Date: 2026-06-18
-- Note: 微型盾构机/掘进机 MES 专用 schema
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 主数据层 (4 tables)
-- ============================================================

-- 1. TBM 型号
CREATE TABLE IF NOT EXISTS tbm_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_code TEXT UNIQUE NOT NULL,             -- e.g., EPB-4000
  model_name TEXT NOT NULL,                    -- e.g., 4m 土压平衡
  diameter_mm INTEGER NOT NULL,                -- 4000
  tbm_type TEXT NOT NULL,                      -- epb / slurry / composite
  designed_thrust_kn INTEGER,
  designed_torque_knm INTEGER,
  installed_power_kw INTEGER,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 9 大子系统字典
CREATE TABLE IF NOT EXISTS tbm_subsystems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,                   -- cutter_head / shield_body / ...
  name_zh TEXT NOT NULL,                       -- 刀盘
  name_en TEXT,                                -- Cutter Head
  sequence INTEGER NOT NULL,                   -- 1-9
  description TEXT
);

-- 3. 工位
CREATE TABLE IF NOT EXISTS workstations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  workshop TEXT,                               -- 切割下料/铆接/焊接/装配
  capacity_per_day INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. 设备
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  equipment_type TEXT,
  workstation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',         -- idle / running / maintenance / broken
  last_maintenance TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workstation_id) REFERENCES workstations(id)
);

-- ============================================================
-- 项目层 (5 tables, 核心)
-- ============================================================

-- 5. 项目 (核心)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,            -- TBM-2026-001
  project_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  site_location TEXT,
  contract_no TEXT,
  tbm_model_id INTEGER,
  start_date TEXT,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'design',       -- design/procurement/manufacturing/assembly/commissioning/shipping/accepted
  progress_pct REAL DEFAULT 0,
  contract_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tbm_model_id) REFERENCES tbm_models(id)
);

-- 6. 项目技术规格
CREATE TABLE IF NOT EXISTS project_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  spec_key TEXT NOT NULL,
  spec_value TEXT,
  spec_unit TEXT,
  notes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 7. 项目 BOM (多层级, parent_id 递归)
CREATE TABLE IF NOT EXISTS project_bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  parent_id INTEGER,                           -- 自引用, NULL = 顶层
  material_id INTEGER,
  level INTEGER NOT NULL DEFAULT 1,            -- 1-5
  quantity REAL NOT NULL DEFAULT 1,
  is_key_component INTEGER NOT NULL DEFAULT 0,
  is_alternative INTEGER NOT NULL DEFAULT 0,
  alternative_group TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES project_bom(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- 8. 设计变更
CREATE TABLE IF NOT EXISTS project_eco (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  eco_no TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  affected_scope TEXT,
  status TEXT NOT NULL DEFAULT 'open',         -- open/approved/closed/rejected
  effective_date TEXT,
  closed_date TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 9. 项目里程碑 S1-S10
CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_code TEXT NOT NULL,                    -- S1-S10
  phase_name TEXT NOT NULL,                    -- 设计冻结/采购/...
  sequence INTEGER NOT NULL,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending/active/completed/delayed
  notes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ============================================================
-- 执行层 (6 tables, 核心)
-- ============================================================

-- 10. 工单
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_code TEXT UNIQUE NOT NULL,                -- WO-TBM2026001-S3-001
  project_id INTEGER NOT NULL,
  milestone_id INTEGER,
  subsystem_id INTEGER,
  parent_wo_id INTEGER,                        -- 上级工单
  title TEXT NOT NULL,
  description TEXT,
  workstation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending/assigned/in_progress/paused/completed/issue/rework
  priority INTEGER DEFAULT 3,                  -- 1-5
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  estimated_hours REAL,
  actual_hours REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES project_milestones(id),
  FOREIGN KEY (subsystem_id) REFERENCES tbm_subsystems(id),
  FOREIGN KEY (parent_wo_id) REFERENCES work_orders(id),
  FOREIGN KEY (workstation_id) REFERENCES workstations(id)
);

-- 11. 工单执行记录
CREATE TABLE IF NOT EXISTS work_order_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  operator_id INTEGER,
  action TEXT NOT NULL,                        -- start/pause/resume/complete/note
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  hours_worked REAL,
  notes TEXT,
  photos TEXT,                                 -- JSON 数组, 文件路径
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- 12. 工单质检
CREATE TABLE IF NOT EXISTS work_order_qc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  inspector_id INTEGER,
  qc_type TEXT NOT NULL,                       -- in_process / final / pre_shipping
  result TEXT NOT NULL,                        -- pass / fail / conditional
  inspection_date TEXT NOT NULL DEFAULT (datetime('now')),
  defect_description TEXT,
  rework_required INTEGER DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(id)
);

-- 13. 焊接记录
CREATE TABLE IF NOT EXISTS weld_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  weld_no TEXT NOT NULL,
  weld_type TEXT,                              -- butt / fillet / socket
  welder_id INTEGER NOT NULL,
  material_lot_id INTEGER,
  welding_procedure TEXT,                      -- WPS 编号
  weld_length_mm REAL,
  inspection_method TEXT,                      -- UT/RT/MT/PT
  inspection_result TEXT,                      -- pass/fail
  inspection_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (welder_id) REFERENCES users(id),
  FOREIGN KEY (material_lot_id) REFERENCES material_lots(id)
);

-- 14. 探伤记录
CREATE TABLE IF NOT EXISTS ndt_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  weld_record_id INTEGER,
  ndt_method TEXT NOT NULL,                    -- UT/RT/MT/PT
  ndt_grade TEXT,                              -- I/II/III
  result TEXT NOT NULL,                        -- pass/fail
  inspector_id INTEGER,
  report_no TEXT,
  report_file TEXT,                            -- 报告文件路径
  inspection_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (weld_record_id) REFERENCES weld_records(id),
  FOREIGN KEY (inspector_id) REFERENCES users(id)
);

-- 15. 装配记录
CREATE TABLE IF NOT EXISTS assembly_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  operator_id INTEGER,
  assembly_date TEXT NOT NULL DEFAULT (datetime('now')),
  torque_value_nm REAL,                       -- 关键扭矩
  clearance_mm REAL,                          -- 关键间隙
  photos TEXT,                                -- JSON 数组
  notes TEXT,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- ============================================================
-- 物料层 (4 tables)
-- ============================================================

-- 16. 物料主数据
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_code TEXT UNIQUE NOT NULL,
  material_name TEXT NOT NULL,
  material_type TEXT,                          -- steel / bought_part / standard_part
  spec TEXT,
  unit TEXT DEFAULT 'pcs',
  is_key_component INTEGER DEFAULT 0,
  is_self_made INTEGER DEFAULT 0,              -- 自制/外购
  default_supplier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 17. 物料批次
CREATE TABLE IF NOT EXISTS material_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  lot_no TEXT NOT NULL,
  supplier TEXT,
  heat_no TEXT,                                -- 炉号
  certificate_no TEXT,                         -- 材质书号
  received_date TEXT,
  quantity REAL,
  unit TEXT,
  quality_status TEXT DEFAULT 'pending',      -- pending/passed/failed
  notes TEXT,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- 18. 关键外购件
CREATE TABLE IF NOT EXISTS key_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  component_type TEXT NOT NULL,                -- main_bearing / reducer / plc / inverter / hydraulic_pump
  supplier TEXT,
  supplier_part_no TEXT,
  lead_time_weeks INTEGER,                     -- 交期(周)
  unit_price REAL,
  risk_level TEXT DEFAULT 'medium',            -- low/medium/high
  notes TEXT,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- 19. 库存
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_lot_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  status TEXT DEFAULT 'available',             -- available/allocated/used/quarantined
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (material_lot_id) REFERENCES material_lots(id)
);

-- ============================================================
-- 质量/服务层 (4 tables)
-- ============================================================

-- 20. 质检
CREATE TABLE IF NOT EXISTS qc_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  work_order_id INTEGER,
  inspection_type TEXT NOT NULL,               -- incoming/in_process/final/pre_shipping
  result TEXT NOT NULL,                        -- pass/fail
  inspector_id INTEGER,
  inspection_date TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY (inspector_id) REFERENCES users(id)
);

-- 21. 出厂资料元数据
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,                      -- certificate / material_cert / drawing / manual / report
  doc_name TEXT NOT NULL,
  doc_no TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- 22. 现场服务
CREATE TABLE IF NOT EXISTS field_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,                  -- assembly / commissioning / warranty / repair
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'normal',              -- low/normal/urgent
  status TEXT NOT NULL DEFAULT 'open',         -- open/assigned/in_progress/resolved/closed
  assigned_to INTEGER,
  reported_date TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_date TEXT,
  resolution_notes TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- 23. 质量反馈/经验库
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  feedback_type TEXT NOT NULL,                 -- defect / improvement / lesson
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT,                               -- low/medium/high/critical
  reported_by INTEGER,
  reported_date TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT DEFAULT 'open',                  -- open/triaged/closed
  resolution TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (reported_by) REFERENCES users(id)
);

-- ============================================================
-- 用户/权限 (2 tables)
-- ============================================================

-- 24. 用户
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  role_id INTEGER,
  phone TEXT,
  cert_no TEXT,                                -- 焊工证号等
  cert_type TEXT,                              -- welder / qc / operator
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 25. 角色
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code TEXT UNIQUE NOT NULL,              -- admin / foreman / worker / qc / engineer
  role_name TEXT NOT NULL,
  permissions TEXT,                            -- JSON 数组
  description TEXT
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code);
CREATE INDEX IF NOT EXISTS idx_project_bom_project ON project_bom(project_id);
CREATE INDEX IF NOT EXISTS idx_project_bom_parent ON project_bom(parent_id);
CREATE INDEX IF NOT EXISTS idx_project_bom_material ON project_bom(material_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_project ON work_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_subsystem ON work_orders(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_wo_ops_wo ON work_order_operations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_qc_wo ON work_order_qc(work_order_id);
CREATE INDEX IF NOT EXISTS idx_weld_records_wo ON weld_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ndt_records_wo ON ndt_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_assembly_records_wo ON assembly_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_lots_material ON material_lots(material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot ON inventory(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_field_service_project ON field_service(project_id);
CREATE INDEX IF NOT EXISTS idx_qc_inspections_project ON qc_inspections(project_id);

-- ============================================================
-- 种子: 9 大子系统
-- ============================================================
INSERT OR IGNORE INTO tbm_subsystems (id, code, name_zh, name_en, sequence) VALUES
  (1, 'cutter_head',  '刀盘',       'Cutter Head',     1),
  (2, 'main_drive',   '主驱动',     'Main Drive',      2),
  (3, 'shield_body',  '盾体',       'Shield Body',     3),
  (4, 'thrust',       '推进系统',   'Thrust System',   4),
  (5, 'erector',      '拼装系统',   'Segment Erector', 5),
  (6, 'mucking',      '出渣系统',   'Mucking System',  6),
  (7, 'hydraulic',    '液压系统',   'Hydraulic System',7),
  (8, 'e_control',    '电气控制',   'E&C System',      8),
  (9, 'trailing',     '后配套',     'Trailing Gear',   9);

-- ============================================================
-- 种子: 角色
-- ============================================================
INSERT OR IGNORE INTO roles (id, role_code, role_name, permissions, description) VALUES
  (1, 'admin',    '管理员',   '["*"]',                                          '系统管理员'),
  (2, 'foreman',  '车间主任', '["project:*","work_order:*","bom:read"]',        '车间主任'),
  (3, 'engineer', '工程师',   '["project:read","bom:*","work_order:read"]',      '设计/工艺工程师'),
  (4, 'worker',   '工人',     '["work_order:read","wo:execute"]',               '车间工人'),
  (5, 'qc',       '质检员',   '["qc:*","work_order:read"]',                     '质检员'),
  (6, 'welder',   '焊工',     '["weld:create","wo:read"]',                      '焊工'),
  (7, 'sales',    '销售',     '["project:read","contract:read"]',               '销售');

-- ============================================================
-- 种子: 示例用户 (简化密码,生产请改)
-- ============================================================
INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role_id) VALUES
  (1, 'admin',     'admin',     '系统管理员', 1),
  (2, 'foreman01', 'foreman01', '张主任',     2),
  (3, 'engineer01','engineer01','李工',       3),
  (4, 'worker01',  'worker01',  '王师傅',     4),
  (5, 'qc01',      'qc01',      '赵质检',     5),
  (6, 'welder01',  'welder01',  '孙焊工',     6);

-- ============================================================
-- 种子: 示例 TBM 型号
-- ============================================================
INSERT OR IGNORE INTO tbm_models (id, model_code, model_name, diameter_mm, tbm_type, designed_thrust_kn, designed_torque_knm, installed_power_kw) VALUES
  (1, 'EPB-4000', '4m 土压平衡盾构机', 4000, 'epb', 25000, 4000, 800),
  (2, 'EPB-6000', '6m 土压平衡盾构机', 6000, 'epb', 40000, 6000, 1200);

-- ============================================================
-- 完成
-- ============================================================
SELECT '002_tbm_phase1.sql applied successfully';
