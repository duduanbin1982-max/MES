-- 2026-11-09 设备台账审计：历史数据中存在 lifecycle_stage='S1'（生命周期目录的别名），
-- 但 domain 规范化只处理 designing/purchasing，导致生命周期流转/台账展示不一致。
-- 统一回写为 design；status 已是 design，不改。
UPDATE equipment_instances
   SET lifecycle_stage = 'design'
 WHERE lifecycle_stage = 'S1';
