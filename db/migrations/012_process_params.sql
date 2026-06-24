-- 012_process_params.sql (P2-#8 工艺参数记录)
CREATE TABLE IF NOT EXISTS process_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_node_id INTEGER NOT NULL,
  recorded_by INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  current_amp REAL,
  voltage_v REAL,
  speed_mm_min REAL,
  temperature_c REAL,
  pressure_mpa REAL,
  feed_rate REAL,
  custom_json TEXT,
  notes TEXT,
  FOREIGN KEY (process_node_id) REFERENCES process_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pp_node_time ON process_params(process_node_id, recorded_at);
SELECT '012 done' as status;
