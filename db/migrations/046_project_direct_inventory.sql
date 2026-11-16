-- 2026-11-16 项目直供库存隔离：项目直供物料进入项目库存，不混入常备库存
ALTER TABLE inventory ADD COLUMN project_id INTEGER;
ALTER TABLE material_lots ADD COLUMN project_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_inventory_project ON inventory(project_id);
CREATE INDEX IF NOT EXISTS idx_material_lots_project ON material_lots(project_id);
