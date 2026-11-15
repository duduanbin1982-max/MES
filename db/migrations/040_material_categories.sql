-- 2026-11-15 物料分类树：大类 + 子类，来源/自制/批次等仍由 materials 属性表达
CREATE TABLE IF NOT EXISTS material_categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER,
  category_code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES material_categories(id)
);

INSERT OR IGNORE INTO material_categories (id, parent_id, category_code, category_name, sort_order) VALUES
  (1, NULL, '01', '原材料', 10),
  (2, NULL, '02', '外购件', 20),
  (3, NULL, '03', '自制件', 30),
  (4, NULL, '04', '五金件', 40),
  (5, NULL, '05', '包装及其他', 50),
  (11, 1, '01-01', '钢材', 11),
  (12, 1, '01-02', '焊材', 12),
  (13, 1, '01-03', '油漆/辅料', 13),
  (14, 1, '01-04', '气体', 14),
  (15, 1, '01-05', '型材', 15),
  (21, 2, '02-01', '机械件', 21),
  (22, 2, '02-02', '电气件', 22),
  (23, 2, '02-03', '液压件', 23),
  (24, 2, '02-04', '密封件', 24),
  (25, 2, '02-05', '轴承/传动', 25),
  (26, 2, '02-06', '紧固件', 26),
  (27, 2, '02-07', '标准件', 27),
  (31, 3, '03-01', '机加件', 31),
  (32, 3, '03-02', '钣金件', 32),
  (33, 3, '03-03', '结构件', 33),
  (34, 3, '03-04', '部件/总成', 34),
  (41, 4, '04-01', '螺栓/螺母/垫圈', 41),
  (42, 4, '04-02', '工具', 42),
  (43, 4, '04-03', '低值易耗', 43);

ALTER TABLE materials ADD COLUMN category_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);

-- 数据清洗：钢板是外购原材料，不是自制件
UPDATE materials SET is_self_made = 0 WHERE material_type = 'steel';

-- 先按具体物料归类（自制件优先）
UPDATE materials SET category_id = 31 WHERE material_code IN ('M-MANIFOLD', 'SP-PIN-001');
UPDATE materials SET category_id = 33 WHERE material_code IN ('M-OIL-TANK', 'M-CAB', 'M-DOOR-MAN', 'M-TRAILER');
UPDATE materials SET category_id = 11 WHERE material_code LIKE 'M-ST-%';
UPDATE materials SET category_id = 12 WHERE material_code LIKE 'M-WL-%' OR material_code LIKE 'M-WS-%';
UPDATE materials SET category_id = 25 WHERE material_code IN ('M-BRG-MAIN', 'M-REDUCER');
UPDATE materials SET category_id = 22 WHERE material_code IN ('M-MOTOR-DRIVE', 'M-VFD', 'M-PLC', 'M-SWITCH', 'M-CABLE');
UPDATE materials SET category_id = 23 WHERE material_code IN ('M-PUMP-MAIN', 'M-CYL-THRUST', 'M-CYL-ART', 'M-PIPE');
UPDATE materials SET category_id = 24 WHERE material_code LIKE 'M-SEAL-%';
UPDATE materials SET category_id = 26 WHERE material_code LIKE 'M-BOLT-%';
UPDATE materials SET category_id = 21 WHERE material_code IN ('M-CUTTER-DISC', 'M-CUTTER-SCRAP', 'M-ERECTOR', 'M-SCREW', 'M-VENT');
UPDATE materials SET category_id = 21 WHERE category_id IS NULL AND material_code LIKE 'M-%';
UPDATE materials SET category_id = 21 WHERE category_id IS NULL AND material_code LIKE 'WG-%';
