-- 017_contract_amount_unit.sql
-- equipment_instances 加 contract_amount_unit (默认 'wan' 万元), 让 cost_rollup 能正确换算
-- 历史数据全部默认 'wan'
-- 2026-06-24

ALTER TABLE equipment_instances ADD COLUMN contract_amount_unit TEXT NOT NULL DEFAULT 'wan'
  CHECK (contract_amount_unit IN ('yuan', 'wan'));
