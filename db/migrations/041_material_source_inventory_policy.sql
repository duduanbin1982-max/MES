-- 2026-11-15 物料业务属性：来源（外购/自制/委外）与库存策略（常备/项目直供/不库存）
ALTER TABLE materials ADD COLUMN source_type TEXT DEFAULT 'purchased';
ALTER TABLE materials ADD COLUMN inventory_policy TEXT DEFAULT 'stock';

UPDATE materials SET source_type = CASE WHEN is_self_made = 1 THEN 'self_made' ELSE 'purchased' END;
-- 关键件默认项目直供，其余常备；后续可在物料主数据中调整
UPDATE materials SET inventory_policy = CASE WHEN is_key_component = 1 THEN 'project' ELSE 'stock' END;

CREATE INDEX IF NOT EXISTS idx_materials_source_type ON materials(source_type);
CREATE INDEX IF NOT EXISTS idx_materials_inventory_policy ON materials(inventory_policy);
