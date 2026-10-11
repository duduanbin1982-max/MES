"use strict";
// tests/helpers/resourcesGanttFixture.js
// 资源甘特 (services/equipment/gantt/resourcesGantt) 的固定测试数据。
// 设计目标：同时覆盖
//   - 有 planned_start / 只有 actual_start 的工单与工序
//   - 有 estimated_hours / 没有 estimated_hours（走默认值）
//   - 同一工位时间重叠（conflict: same_workstation / cross_instance）
//   - 单日忙时超过产能（conflict: capacity_overload）
//   - 未分配工位（ws_id 为空，不进热力图）

const Database = require("better-sqlite3");

function seedGanttDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT
    );
    CREATE TABLE workstations (
      id INTEGER PRIMARY KEY, name TEXT, workshop TEXT,
      capacity_per_day REAL, max_workers INTEGER, shift TEXT, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_code TEXT, title TEXT, estimated_hours REAL,
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      status TEXT, workstation_id INTEGER, equipment_instance_id INTEGER
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_name TEXT, estimated_hours REAL,
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      status TEXT, required_workstation_id INTEGER, equipment_instance_id INTEGER
    );

    INSERT INTO equipment_instances VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机');
    INSERT INTO workstations VALUES
      (10, '工位A', '机加车间', 1, 1, 'day', 1),
      (11, '工位B', '机加车间', 2, 2, 'day', 1),
      (12, '停用工位', '机加车间', 1, 1, 'day', 0),
      (13, '工位C', '装配车间', 1, 1, 'day', 1);

    INSERT INTO work_orders (id, wo_code, title, estimated_hours, planned_start, planned_end, actual_start, actual_end, status, workstation_id, equipment_instance_id)
    VALUES
      (1, 'WO-1', '焊接', 8, '2026-10-12', NULL, NULL, NULL, 'in_progress', 10, 1),
      (2, 'WO-2', '装配', 16, NULL, NULL, '2026-10-12 08:00:00', '2026-10-12 20:00:00', 'completed', 10, 1),
      (3, 'WO-3', '喷涂', 4, '2026-10-15', NULL, NULL, NULL, 'pending', 11, 2),
      (4, 'WO-4', '包装', 2, NULL, NULL, NULL, NULL, 'pending', NULL, 2),
      -- 工时刚好 6h / 日产能 8h = 75%：正好卡在 busy(>=80) 与 normal(>=30) 之间，
      -- 用来锁住热力图的 level 阈值（否则把 80 改成 70 也测不出来）
      (5, 'WO-5', '总装', 6, '2026-10-13', NULL, NULL, NULL, 'pending', 13, 2);

    INSERT INTO process_nodes (id, operation_name, estimated_hours, planned_start, planned_end, actual_start, actual_end, status, required_workstation_id, equipment_instance_id)
    VALUES
      (1, '钻孔', 12, '2026-10-12', '2026-10-13', NULL, NULL, 'pending', 10, 1),
      (2, '打磨', NULL, '2026-10-13', NULL, NULL, NULL, 'pending', 11, 2),
      (3, '检验', 6, NULL, NULL, '2026-10-14 09:00:00', NULL, 'in_progress', NULL, 1),
      (4, '超窗口工序', 5, '2026-12-01', '2026-12-02', NULL, NULL, 'pending', 11, 2);
  `);
  return db;
}

module.exports = { seedGanttDb };
