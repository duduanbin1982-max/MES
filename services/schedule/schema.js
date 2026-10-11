"use strict";
// services/schedule/schema.js
// schedule_assignments 建表 + 历史脏数据清理 + 索引。
// (原 services/scheduleService.js 第 8-46 行)
// DDL 字符串保持逐字不变 —— service-schema 指纹依赖它。

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      user_id INTEGER,
      workstation_id INTEGER,
      planned_start TEXT,
      planned_end TEXT,
      estimated_hours REAL,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'planned',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (process_node_id) REFERENCES process_nodes(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workstation_id) REFERENCES workstations(id)
    )
  `);

  db.exec(`
    DELETE FROM schedule_assignments
    WHERE status IN ('assigned', 'in_progress', 'pending')
      AND id NOT IN (
        SELECT MAX(id)
        FROM schedule_assignments
        WHERE status IN ('assigned', 'in_progress', 'pending')
        GROUP BY process_node_id
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_assignments_active_node
      ON schedule_assignments(process_node_id)
      WHERE status IN ('assigned', 'in_progress', 'pending');
    CREATE INDEX IF NOT EXISTS idx_schedule_assignments_user_status
      ON schedule_assignments(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_schedule_assignments_workstation_dates
      ON schedule_assignments(workstation_id, planned_start, planned_end);
  `);
}

module.exports = { runMigration };
