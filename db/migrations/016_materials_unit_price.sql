-- 016_materials_unit_price.sql
-- 给 materials 加 estimated_unit_price 和 actual_unit_price 两列
-- 用于 cost_rollup 计算普通物料估价/实际价
-- 2026-06-24

ALTER TABLE materials ADD COLUMN estimated_unit_price REAL NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN actual_unit_price REAL NOT NULL DEFAULT 0;

-- 关键件如果在 materials 中也出现 (is_key_component=1), 同步从 key_components.unit_price
UPDATE materials
   SET estimated_unit_price = (
     SELECT kc.unit_price FROM key_components kc
      WHERE kc.material_id = materials.id
   )
 WHERE id IN (SELECT material_id FROM key_components);
