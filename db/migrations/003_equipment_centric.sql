-- ============================================================
-- 003_equipment_centric.sql
-- 抽象"成套装备"为一级实体
-- 加 3 张新表 (equipment_types, equipment_models, equipment_instances)
-- 改 3 张表名 (tbm_models/tbm_subsystems/projects → equipment_*)
-- 加 FK 关联 + 新字段
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

PRAGMA foreign_keys = ON;  -- 临时关掉，迁移后再开

-- ============================================================
-- 1) 新表: equipment_types (产品类别)
-- ============================================================
CREATE TABLE IF NOT EXISTS equipment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,                  -- TBM / BREAKER / EXCAVATOR
  name_zh TEXT NOT NULL,                      -- 盾构机/破碎锤/挖掘机
  name_en TEXT,
  category TEXT,                              -- tunnel / mining / construction
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 种子: 4 大产品类别
INSERT OR IGNORE INTO equipment_types (id, code, name_zh, name_en, category, description) VALUES
  (1, 'TBM',       '盾构机/掘进机',  'Tunnel Boring Machine', 'tunnel',       '隧道掘进成套装备 Ø3-15m'),
  (2, 'BREAKER',   '液压破碎锤',     'Hydraulic Breaker',     'mining',       '挖掘机配套用'),
  (3, 'EXCAVATOR', '履带式挖掘机',   'Crawler Excavator',     'construction', '通用土方工程机械'),
  (4, 'PUMP',      '大型工业泵',     'Industrial Pump',       'process',      '化工/矿业用泵');

-- ============================================================
-- 2) 改名: tbm_models → equipment_models + 加 FK
-- ============================================================
ALTER TABLE tbm_models RENAME TO equipment_models;

-- 加 equipment_type_id 列
ALTER TABLE equipment_models ADD COLUMN equipment_type_id INTEGER REFERENCES equipment_types(id);

-- 已有 2 行 (EPB-4000, EPB-6000) → 默认归 TBM 类
UPDATE equipment_models SET equipment_type_id = 1 WHERE equipment_type_id IS NULL;

-- ============================================================
-- 3) 改名: tbm_subsystems → equipment_subsystems + 加 FK
-- ============================================================
ALTER TABLE tbm_subsystems RENAME TO equipment_subsystems;

ALTER TABLE equipment_subsystems ADD COLUMN equipment_type_id INTEGER REFERENCES equipment_types(id);

-- 已有 9 行 (刀盘/主驱动/...) → 默认归 TBM 类
UPDATE equipment_subsystems SET equipment_type_id = 1 WHERE equipment_type_id IS NULL;

-- ============================================================
-- 4) 改名: projects → equipment_instances + 加字段
-- ============================================================
ALTER TABLE projects RENAME TO equipment_instances;

-- 列改名 (project_code/project_name → instance_code/instance_name)
ALTER TABLE equipment_instances RENAME COLUMN project_code TO instance_code;
ALTER TABLE equipment_instances RENAME COLUMN project_name TO instance_name;

-- 加 equipment_model_id FK
ALTER TABLE equipment_instances ADD COLUMN equipment_model_id INTEGER REFERENCES equipment_models(id);

-- 加 lifecycle_stage (S1-S10) 和 serial_no (出厂序列号)
ALTER TABLE equipment_instances ADD COLUMN lifecycle_stage TEXT;
ALTER TABLE equipment_instances ADD COLUMN serial_no TEXT;

-- 已有 TBM-2026-001 → 关联到 EPB-4000
UPDATE equipment_instances
SET equipment_model_id = (SELECT id FROM equipment_models WHERE model_code = 'EPB-4000')
WHERE equipment_model_id IS NULL AND instance_code LIKE 'TBM-%';

-- 根据 status 推断 lifecycle_stage
UPDATE equipment_instances
SET lifecycle_stage = CASE status
  WHEN 'design' THEN 'S1'
  WHEN 'procurement' THEN 'S2'
  WHEN 'manufacturing' THEN 'S3'
  WHEN 'assembly' THEN 'S5'
  WHEN 'commissioning' THEN 'S6'
  WHEN 'shipping' THEN 'S7'
  WHEN 'accepted' THEN 'S10'
  ELSE 'S1'
END
WHERE lifecycle_stage IS NULL;

-- ============================================================
-- 5) 更新所有 project_id → equipment_instance_id 的表
-- ============================================================

-- project_bom → instance_bom
ALTER TABLE project_bom RENAME TO instance_bom;
ALTER TABLE instance_bom RENAME COLUMN project_id TO equipment_instance_id;

-- project_milestones → instance_milestones
ALTER TABLE project_milestones RENAME TO instance_milestones;
ALTER TABLE instance_milestones RENAME COLUMN project_id TO equipment_instance_id;

-- project_eco → instance_eco
ALTER TABLE project_eco RENAME TO instance_eco;
ALTER TABLE instance_eco RENAME COLUMN project_id TO equipment_instance_id;

-- project_specs → instance_specs
ALTER TABLE project_specs RENAME TO instance_specs;
ALTER TABLE instance_specs RENAME COLUMN project_id TO equipment_instance_id;

-- work_orders (只改列名)
ALTER TABLE work_orders RENAME COLUMN project_id TO equipment_instance_id;

-- qc_inspections
ALTER TABLE qc_inspections RENAME COLUMN project_id TO equipment_instance_id;

-- documents
ALTER TABLE documents RENAME COLUMN project_id TO equipment_instance_id;

-- field_service
ALTER TABLE field_service RENAME COLUMN project_id TO equipment_instance_id;

-- feedback (project_id 可以为 NULL, 也要改)
ALTER TABLE feedback RENAME COLUMN project_id TO equipment_instance_id;

-- ============================================================
-- 6) 重新启用外键 (SQLite 不允许 ALTER TABLE PRAGMA, 关掉再开)
-- ============================================================
PRAGMA foreign_keys = ON;

-- ============================================================
-- 7) 索引 (按新列名)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_equipment_models_type ON equipment_models(equipment_type_id);
CREATE INDEX IF NOT EXISTS idx_equipment_subsystems_type ON equipment_subsystems(equipment_type_id);
CREATE INDEX IF NOT EXISTS idx_equipment_instances_model ON equipment_instances(equipment_model_id);
CREATE INDEX IF NOT EXISTS idx_equipment_instances_code ON equipment_instances(instance_code);
CREATE INDEX IF NOT EXISTS idx_instance_bom_instance ON instance_bom(equipment_instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_milestones_instance ON instance_milestones(equipment_instance_id);

-- ============================================================
-- 8) 完成
-- ============================================================
SELECT '003_equipment_centric.sql applied successfully';