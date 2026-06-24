-- 015_key_component_prices.sql
-- 关键件合同价跟踪 + 差价分析
-- 业务背景:
--   key_components.unit_price 是采购估价 (added in 014)
--   实际合同签下来后, 把 actual_price 落到 key_component_prices 表
--   一件一价: 一行 = 一次谈下的合同价 (1:n history, 永远保留 audit)
--   key_components.last_price_id 反指"当前生效"那条合同价
--   差价 price_diff 在视图里算 (actual - unit_price)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS key_component_prices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  key_component_id INTEGER NOT NULL,
  actual_price     REAL NOT NULL,
  contract_no      TEXT,
  vendor_po        TEXT,
  currency         TEXT NOT NULL DEFAULT 'CNY',
  valid_from       TEXT NOT NULL,
  valid_to         TEXT,
  notes            TEXT,
  priced_by        INTEGER,
  priced_at        TEXT NOT NULL,
  FOREIGN KEY (key_component_id) REFERENCES key_components(id) ON DELETE CASCADE,
  FOREIGN KEY (priced_by)       REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_kcp_kc ON key_component_prices(key_component_id);
CREATE INDEX IF NOT EXISTS idx_kcp_valid ON key_component_prices(key_component_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_kcp_priced_by ON key_component_prices(priced_by);

ALTER TABLE key_components ADD COLUMN last_price_id INTEGER REFERENCES key_component_prices(id);

CREATE TRIGGER IF NOT EXISTS trg_kcp_close_previous
AFTER INSERT ON key_component_prices
FOR EACH ROW
WHEN NEW.valid_to IS NULL
BEGIN
  UPDATE key_component_prices
     SET valid_to = NEW.valid_from
   WHERE key_component_id = NEW.key_component_id
     AND id != NEW.id
     AND valid_to IS NULL;
  UPDATE key_components
     SET last_price_id = NEW.id
   WHERE id = NEW.key_component_id;
END;

CREATE VIEW IF NOT EXISTS v_key_component_price_diff AS
SELECT
  kc.id            AS key_component_id,
  kc.component_type,
  kc.supplier,
  kc.supplier_part_no,
  kc.lead_time_weeks,
  kc.unit_price    AS estimated_price,
  m.material_name,
  m.material_code,
  kcp.actual_price AS actual_price,
  kcp.id           AS current_price_id,
  kcp.contract_no  AS contract_no,
  kcp.valid_from   AS price_valid_from,
  kcp.priced_at    AS priced_at,
  u.username       AS priced_by_username,
  ROUND(COALESCE(kcp.actual_price, 0) - COALESCE(kc.unit_price, 0), 4) AS price_diff,
  CASE
    WHEN kcp.actual_price IS NULL THEN 'no_contract_yet'
    WHEN kcp.actual_price <= kc.unit_price THEN 'on_or_under_budget'
    WHEN kcp.actual_price <= kc.unit_price * 1.1 THEN 'over_10pct'
    WHEN kcp.actual_price <= kc.unit_price * 1.2 THEN 'over_20pct'
    ELSE 'over_20pct'
  END AS cost_status
FROM key_components kc
LEFT JOIN materials m              ON m.id = kc.material_id
LEFT JOIN key_component_prices kcp ON kcp.id = kc.last_price_id
LEFT JOIN users u                  ON u.id = kcp.priced_by;

SELECT '015 done' as status;
