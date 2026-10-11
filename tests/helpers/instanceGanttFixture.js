"use strict";
// tests/helpers/instanceGanttFixture.js
// instanceGantt 等价性测试的固定数据。
// 表结构取自 tests/fixtures/instanceGantt-tables.sql（生产库导出）。
//
// 覆盖点：
//   instance 1 —— 正常：有排程/无排程混合、多状态、工位与子系统分组、零时长节点
//   instance 2 —— 全部未排程（只有 start_date），走 buildFallbackScheduler
//   instance 3 —— 无任何节点，走 early-return 分支
//   instance 4 —— 依赖链 + 环（验证 calcStart 的 visiting 守卫不会栈溢出）
//   instance 5 —— estimated_hours 缺失时用 planned 区间兜底、只有 planned_start 时补算

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DDL = fs.readFileSync(path.join(__dirname, "..", "fixtures", "instanceGantt-tables.sql"), "utf8");

function seedInstanceGanttDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(DDL);
  db.exec(`
    INSERT INTO equipment_instances (id, instance_code, instance_name, customer_name, planned_start, start_date, status, progress_pct)
    VALUES
      (1, 'TBM-1', '一号机', '甲客户', '2026-10-05 08:00:00', NULL,               'manufacturing', 50),
      (2, 'TBM-2', '二号机', '乙客户', NULL,                   '2026-10-06',        'manufacturing', 20),
      (3, 'TBM-3', '三号机', '丙客户', '2026-10-07 08:00:00', NULL,               'planning',       0),
      (4, 'TBM-4', '四号机', '丁客户', '2026-10-08 08:00:00', NULL,               'manufacturing', 10),
      (5, 'TBM-5', '五号机', '戊客户', '2026-10-09 08:00:00', NULL,               'manufacturing', 80);

    INSERT INTO workstations (id, code, name, workshop, is_active) VALUES (1, 'WS-1', '工位A', '机加车间', 1);
    INSERT INTO equipment_subsystems (id, code, name_zh, sequence) VALUES (1, 'SS-1', '主驱动', 1), (2, 'SS-2', '刀盘', 2);

    INSERT INTO process_nodes
      (id, equipment_instance_id, operation_name, sequence, estimated_hours, required_workstation_id, phase_code,
       status, planned_start, planned_end, actual_start, actual_end, subsystem_id, bom_node_id)
    VALUES
      -- instance 1: 已排程完成 + 进行中 + 未排程 + 零时长
      (101, 1, '总装', 1, 16, 1, 'P1', 'completed',   '2026-10-05 08:00:00', '2026-10-07 08:00:00', '2026-10-05 09:00:00', '2026-10-07 07:00:00', 1, 5),
      (102, 1, '调试', 2,  8, NULL, 'P1', 'in_progress', '2026-10-07 08:00:00', '2026-10-08 08:00:00', '2026-10-07 09:00:00', NULL, 2, NULL),
      (103, 1, '验收', 3, NULL, NULL, 'P2', 'pending',   NULL, NULL, NULL, NULL, NULL, NULL),
      (104, 1, '零时长', 4, 0, NULL, NULL, 'pending',    '2026-10-12 08:00:00', '2026-10-12 08:00:00', NULL, NULL, NULL, NULL),
      -- instance 2: 全部无排程（应走 fallback 排程）
      (201, 2, '下料', 1, 4, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      (202, 2, '焊接', 2, NULL, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      (203, 2, '打磨', 3, 6, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      -- instance 4: 依赖链 + 环
      (401, 4, '工序A', 1, 5, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      (402, 4, '工序B', 2, 5, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      (403, 4, '工序C', 3, 5, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      -- instance 5: 工时缺失/只有开始/完成态
      -- 501 的 planned 区间特意用 4 小时（不是 8），否则"用 planned 区间兜底"与
      -- "回落 8 小时工作制"会得到同一个值，测不出区别
      (501, 5, '带计划无工时', 1, NULL, NULL, 'P3', 'pending', '2026-10-09 08:00:00', '2026-10-09 12:00:00', NULL, NULL, NULL, NULL),
      (502, 5, '只有开始', 2, 3, NULL, NULL, 'pending', '2026-10-10 08:00:00', NULL, NULL, NULL, NULL, NULL),
      (503, 5, '缺工时缺计划', 3, NULL, NULL, NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
      (504, 5, '已完成', 4, 2, NULL, NULL, 'completed', '2026-10-11 08:00:00', '2026-10-11 10:00:00', '2026-10-11 08:10:00', '2026-10-11 09:50:00', NULL, 9);

    INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id, dep_type)
    VALUES
      (4, 401, 402, 'FS'),
      (4, 402, 403, 'FS'),
      (4, 403, 402, 'FS'),          -- 环：calcStart 的 visiting 守卫必须兜住
      (2, 201, 202, 'FS'),
      (2, 202, 203, 'FS');
  `);
  return db;
}

module.exports = { seedInstanceGanttDb };
