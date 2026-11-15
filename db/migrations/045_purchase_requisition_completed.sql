-- 2026-11-15 采购到货闭环：采购申请完成时间
ALTER TABLE purchase_requisitions ADD COLUMN completed_at TEXT;
