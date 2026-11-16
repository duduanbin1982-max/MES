-- 2026-11-16 项目材料成本：批次成本、领料金额、项目成本台账
ALTER TABLE material_lots ADD COLUMN unit_cost REAL DEFAULT 0;
ALTER TABLE material_movements ADD COLUMN unit_cost REAL DEFAULT 0;
ALTER TABLE material_movements ADD COLUMN amount REAL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_material_lots_unit_cost ON material_lots(unit_cost);
