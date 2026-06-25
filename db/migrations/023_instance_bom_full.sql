-- P2 BOM 全面升级 (12 字段 + 4 级 + ECO)
PRAGMA foreign_keys = OFF;

-- 023_instance_bom_full.sql
-- P2 BOM 全面升级 (对照文章 12 字段 + 4 级结构 + ECO 追溯)
--   现表: id, equipment_instance_id, parent_id, material_id, level, quantity,
--         is_key_component, is_alternative, alternative_group, notes, created_at
-- Author: 三狗子 | Date: 2026-06-25

-- 1. 备份 + 重建 (一次性升级, 老数据保留)
ALTER TABLE instance_bom RENAME TO instance_bom_v22;

CREATE TABLE instance_bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 归属
  equipment_instance_id INTEGER NOT NULL,
  parent_id INTEGER,                       -- NULL = 根 (0 级总装)

  -- 层级与版本 (新)
  tier INTEGER NOT NULL DEFAULT 2,         -- 0 总装 / 1 部件 / 2 零件 / 3 毛坯 (文章 4 级)
  version TEXT DEFAULT 'A0',               -- A0/A1/B0 (图版号)
  eco_id INTEGER,                          -- 关联设计变更
  effective_from TEXT,                     -- 生效起始
  effective_to TEXT,                       -- 生效截止 (NULL = 长期)

  -- 物料引用 (强一致: 跨 BOM 共用同一物料)
  material_id INTEGER,                     -- 关联 materials.id (NULL = 虚项/虚拟件)
  part_number TEXT,                        -- 图号/型号 (外购件: 官方型号如 CDQ2B63-100DZ; 自制件: 内部图号)

  -- 数量属性
  quantity REAL NOT NULL DEFAULT 1,        -- 单台净用量
  unit TEXT DEFAULT '件',                  -- 件/个/米/千克/套
  scrap_factor REAL DEFAULT 1.0,           -- 损耗系数 (EBOM 净用量 × scrap = MBOM 实际采购量, 默认 1.0)

  -- 物料分类 (新, 7 大类)
  category TEXT,                           -- 自制机加件/自制钣金件/标准紧固件/气动元件/电气元件/外购成品/辅助材料

  -- 技术要求 (新)
  material_grade TEXT,                     -- 材质牌号: 45钢/Q235B/6061-T6/304不锈钢/8.8级碳钢
  surface_treatment TEXT,                  -- 表面处理: 调质HB220-250/阳极氧化/喷塑RAL7035/发黑/镀锌
  brand_recommend TEXT,                    -- 推荐品牌: SMC/亚德客/东明/--  (A 级 / B 级 / "不可替代")
  brand_grade TEXT,                        -- A/B/不可替代

  -- 替代料 (新: 加 priority)
  is_alternative INTEGER DEFAULT 0,
  alternative_group TEXT,                  -- 同组互替
  alternative_priority INTEGER DEFAULT 1,  -- 同组内优先级: 1=首选, 2=次选

  -- 工艺关联 (新)
  operation_id INTEGER,                    -- 关联 process_tree_node.id (这道零件在哪道工序消耗)
  is_phantom INTEGER DEFAULT 0,            -- 虚项: 不出现在库存/MRP, 只用于结构展示

  -- 关键性/易损
  is_key_component INTEGER DEFAULT 0,
  is_wear_part INTEGER DEFAULT 0,          -- 易损件 (售后备件用)
  storage_location TEXT,                   -- 存放位置 (库位/柜号)

  -- 成本 (冗余, 加速汇总)
  unit_price REAL,                         -- 估价 (来自 materials.unit_price, 冗余以便成本汇总)
  weight REAL,                             -- 单重 (kg)

  -- 管理追溯
  notes TEXT,                              -- 备注: "左件/右件/与XX配作/不可替代/现场加工"
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,

  FOREIGN KEY (parent_id) REFERENCES instance_bom(id),
  FOREIGN KEY (equipment_instance_id) REFERENCES equipment_instances(id),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (eco_id) REFERENCES instance_eco(id)
);

-- 迁移老数据 (v22 -> 新表)
INSERT INTO instance_bom (
  id, equipment_instance_id, parent_id, material_id, tier, quantity, unit,
  is_key_component, is_alternative, alternative_group, notes, created_at,
  version, scrap_factor, alternative_priority, is_phantom
)
SELECT
  id, equipment_instance_id, parent_id, material_id,
  -- 老 level 1 = 新 tier 0 总装, 2 = 1 部件, 3 = 2 零件, 4+ = 3 毛坯
  CASE
    WHEN level = 1 THEN 0
    WHEN level = 2 THEN 1
    WHEN level = 3 THEN 2
    ELSE 3
  END,
  quantity, '件',
  is_key_component, is_alternative, alternative_group, notes, created_at,
  'A0', 1.0, 1, 0
FROM instance_bom_v22;

DROP TABLE instance_bom_v22;

-- 索引
CREATE INDEX idx_bom_instance ON instance_bom(equipment_instance_id, tier);
CREATE INDEX idx_bom_parent ON instance_bom(parent_id);
CREATE INDEX idx_bom_material ON instance_bom(material_id);
CREATE INDEX idx_bom_eco ON instance_bom(eco_id) WHERE eco_id IS NOT NULL;
CREATE INDEX idx_bom_effective ON instance_bom(effective_from, effective_to);
CREATE INDEX idx_bom_version ON instance_bom(equipment_instance_id, version);