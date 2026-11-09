-- 2026-11-09 经营分析审计：演练机合同金额 1,000,000 被错误标记为“万元”，
-- 导致显式选择演练机时显示 100 亿元合同。修正为元；仅在原值匹配时执行，避免误改真实数据。
UPDATE equipment_instances
   SET contract_amount_unit = 'yuan'
 WHERE instance_code = 'TBM-DEMO-001'
   AND contract_amount = 1000000
   AND contract_amount_unit = 'wan';
