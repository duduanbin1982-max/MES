-- 019_material_units.sql
-- 物料单位换算 (P2-9 业务支持)
-- 业务背景:
--   钢卷入库按 "卷" (1 卷 = 5 吨), 领料按 "kg"
--   若没换算, 库存 10 卷 领 100kg 会算错
--   引入 material_units 记录 from_unit -> to_unit 的 factor
--   领料时按 factor 换算 quantity 写入 inventory
--
-- Author: 三狗子 | Date: 2026-06-25

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS material_units (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id     INTEGER NOT NULL,
  from_unit       TEXT NOT NULL,
  to_unit         TEXT NOT NULL,
  factor          REAL NOT NULL,                  -- 1 from = factor to
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (material_id, from_unit, to_unit),
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

CREATE INDEX IF NOT EXISTS idx_material_units_mat ON material_units(material_id);
