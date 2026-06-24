-- 011_inventory_alert.sql (P2-#1 物料管理深化)
-- 1) materials 加 safety_stock 安全库存（默认 0）
-- 2) materials 加 reorder_point 补货点（默认 0）
-- Author: 三狗子 | Date: 2026-06-22

ALTER TABLE materials ADD COLUMN safety_stock REAL NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN reorder_point REAL NOT NULL DEFAULT 0;

-- 索引加速库存查询
CREATE INDEX IF NOT EXISTS idx_inventory_lot ON inventory(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_movements_lot_type ON material_movements(material_lot_id, movement_type);

SELECT '011 done' as status;
