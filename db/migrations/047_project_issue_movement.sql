-- 2026-11-16 项目直供领料：按装备记录项目库存消耗
ALTER TABLE material_movements ADD COLUMN equipment_instance_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_material_movements_equipment ON material_movements(equipment_instance_id);
