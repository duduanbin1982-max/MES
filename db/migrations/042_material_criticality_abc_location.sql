-- 2026-11-15 物料关键性、ABC 分类、默认库位
ALTER TABLE materials ADD COLUMN criticality TEXT DEFAULT 'normal';
ALTER TABLE materials ADD COLUMN abc_class TEXT DEFAULT 'C';
ALTER TABLE materials ADD COLUMN default_location TEXT;

UPDATE materials SET criticality = CASE WHEN is_key_component = 1 THEN 'critical' ELSE 'normal' END;
UPDATE materials SET abc_class = CASE
  WHEN is_key_component = 1 THEN 'A'
  WHEN category_id IN (13, 14) OR category_id BETWEEN 41 AND 43 THEN 'C'
  ELSE 'B'
END;
UPDATE materials SET default_location = CASE
  WHEN category_id IN (13, 14) THEN '危险品库'
  WHEN category_id BETWEEN 11 AND 15 THEN '原料库'
  WHEN category_id BETWEEN 21 AND 27 THEN '外购件库'
  WHEN category_id BETWEEN 31 AND 34 THEN '自制件库'
  WHEN category_id BETWEEN 41 AND 43 THEN '五金库'
  WHEN category_id = 5 THEN '辅料库'
  ELSE '主仓库'
END;

CREATE INDEX IF NOT EXISTS idx_materials_criticality ON materials(criticality);
CREATE INDEX IF NOT EXISTS idx_materials_abc_class ON materials(abc_class);
CREATE INDEX IF NOT EXISTS idx_materials_default_location ON materials(default_location);
