-- 2026-11-12 移动端时间审计：设备时间偏差/过旧/未来时间记录
CREATE TABLE IF NOT EXISTS mobile_time_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  operator_id INTEGER,
  action TEXT,
  target_type TEXT,
  target_id INTEGER,
  client_time TEXT,
  client_now TEXT,
  server_time TEXT NOT NULL,
  clock_skew_seconds INTEGER,
  accepted INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mobile_time_audits_created ON mobile_time_audits(created_at);
CREATE INDEX IF NOT EXISTS idx_mobile_time_audits_device ON mobile_time_audits(device_id, created_at);
