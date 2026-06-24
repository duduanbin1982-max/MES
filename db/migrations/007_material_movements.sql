-- ============================================================
-- 007_material_movements.sql
-- 物料移动追踪: 收货/领料/退料/调拨/盘点
-- Author: 三狗子 | Date: 2026-06-18
-- ============================================================

CREATE TABLE IF NOT EXISTS material_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_lot_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,                 -- receive / issue / return / transfer / adjust
  quantity REAL NOT NULL,                       -- 正数入库, 负数出库
  unit TEXT,
  from_location TEXT,                            -- 调拨: 源库位
  to_location TEXT,                              -- 调拨: 目标库位
  work_order_id INTEGER,                         -- 关联工单 (领料)
  project_id INTEGER,                            -- 关联项目
  operator_id INTEGER,                            -- 操作人
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (material_lot_id) REFERENCES material_lots(id),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_movements_lot ON material_movements(material_lot_id);
CREATE INDEX IF NOT EXISTS idx_movements_wo ON material_movements(work_order_id);
CREATE INDEX IF NOT EXISTS idx_movements_type ON material_movements(movement_type);

SELECT '007 done' as status;
