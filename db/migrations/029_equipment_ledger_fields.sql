-- 2026-11-10 设备台账拆分：车间生产设备主数据字段
-- @ensure-column equipment asset_no TEXT
-- @ensure-column equipment manufacturer TEXT
-- @ensure-column equipment model TEXT
-- @ensure-column equipment serial_no TEXT
-- @ensure-column equipment location TEXT
-- @ensure-column equipment criticality TEXT DEFAULT 'B'
-- @ensure-column equipment purchase_date TEXT
-- @ensure-column equipment warranty_end TEXT
-- @ensure-column equipment responsible_user_id INTEGER
-- @ensure-column equipment notes TEXT
-- @ensure-column equipment updated_at TEXT
UPDATE equipment SET asset_no = code WHERE asset_no IS NULL OR asset_no = '';
UPDATE equipment SET updated_at = COALESCE(updated_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_asset_no ON equipment(asset_no) WHERE asset_no IS NOT NULL AND asset_no <> '';
