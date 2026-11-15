-- 2026-11-15 物料批次管理策略：1=批次管理（入库必须填批次号），0=非批次管理（默认批次累加）
ALTER TABLE materials ADD COLUMN lot_managed INTEGER DEFAULT 0;
