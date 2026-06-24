-- 014_key_component_unit_price.sql
-- 补齐 11 个关键件的采购参考价 (单位: 万元/件, 2024-2026 行业典型价位)
-- 这些是采购估价，不是合同价；后续由 ERP / 采购单覆盖

UPDATE key_components SET unit_price = 380  WHERE id = 4  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 520  WHERE id = 12 AND unit_price IS NULL;
UPDATE key_components SET unit_price = 65   WHERE id = 5  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 95   WHERE id = 8  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 22   WHERE id = 6  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 1.8  WHERE id = 7  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 58   WHERE id = 11 AND unit_price IS NULL;
UPDATE key_components SET unit_price = 4.5  WHERE id = 9  AND unit_price IS NULL;
UPDATE key_components SET unit_price = 4    WHERE id = 10 AND unit_price IS NULL;
UPDATE key_components SET unit_price = 18   WHERE id = 13 AND unit_price IS NULL;
UPDATE key_components SET unit_price = 14   WHERE id = 14 AND unit_price IS NULL;

SELECT '014 done' as status;
