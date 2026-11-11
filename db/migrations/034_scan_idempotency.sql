-- 2026-11-11 移动端离线补传：扫码动作幂等回执
CREATE TABLE IF NOT EXISTS scan_action_receipts (
  idempotency_key TEXT PRIMARY KEY,
  device_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  operator_id INTEGER,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scan_receipts_created ON scan_action_receipts(created_at);
