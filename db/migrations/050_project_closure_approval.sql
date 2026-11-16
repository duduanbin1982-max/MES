-- 2026-11-16 项目库存关闭审批与生命周期联动
ALTER TABLE project_inventory_closures ADD COLUMN status TEXT DEFAULT 'submitted';
ALTER TABLE project_inventory_closures ADD COLUMN submitted_by INTEGER;
ALTER TABLE project_inventory_closures ADD COLUMN submitted_at TEXT;
ALTER TABLE project_inventory_closures ADD COLUMN approved_by INTEGER;
ALTER TABLE project_inventory_closures ADD COLUMN approved_at TEXT;
ALTER TABLE project_inventory_closures ADD COLUMN rejected_by INTEGER;
ALTER TABLE project_inventory_closures ADD COLUMN rejected_at TEXT;
ALTER TABLE project_inventory_closures ADD COLUMN reject_reason TEXT;
ALTER TABLE project_inventory_closures ADD COLUMN processed_at TEXT;
ALTER TABLE equipment_instances ADD COLUMN project_inventory_closed_at TEXT;
ALTER TABLE equipment_instances ADD COLUMN project_inventory_closed_by INTEGER;
UPDATE project_inventory_closures SET status='approved', approved_at=closed_at, processed_at=closed_at WHERE status IS NULL OR status='';
