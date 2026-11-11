"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { recalcWorkOrderTimer } = require("../services/workOrderTimer");
const { validateScanQuantities } = require("../services/scanner");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, status TEXT, actual_start TEXT, actual_end TEXT,
      actual_duration_seconds INTEGER DEFAULT 0, actual_duration_hours REAL DEFAULT 0, timer_status TEXT DEFAULT 'stopped', updated_at TEXT);
    CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, action TEXT, timestamp TEXT);
    INSERT INTO work_orders (id,status,actual_start) VALUES (1,'completed','2026-01-01 08:00:00');
    INSERT INTO work_order_operations (work_order_id,action,timestamp) VALUES
      (1,'start','2026-01-01 08:00:00'),
      (1,'pause','2026-01-01 08:30:00'),
      (1,'start','2026-01-01 09:00:00'),
      (1,'complete','2026-01-01 10:00:00');
  `);
  return db;
}

test("TIMER.1 pause/resume 只累计有效用时", () => {
  const db = makeDb();
  const result = recalcWorkOrderTimer(db, 1);
  assert.equal(result.actual_duration_seconds, 5400, "08:00-08:30 + 09:00-10:00 = 90 分钟");
  assert.equal(result.actual_duration_hours, 1.5);
  assert.equal(result.timer_status, "stopped");
  const row = db.prepare("SELECT actual_duration_seconds, actual_duration_hours, timer_status FROM work_orders WHERE id=1").get();
  assert.deepEqual(row, { actual_duration_seconds: 5400, actual_duration_hours: 1.5, timer_status: "stopped" });
  db.close();
});

test("TIMER.2 扫码 start 允许 0/空工时，负数仍拒绝", () => {
  assert.deepEqual(validateScanQuantities({ action: "start", hours_worked: 0 }), { hours: null, quantityCompleted: 0, defectQuantity: 0 });
  assert.deepEqual(validateScanQuantities({ action: "start" }), { hours: null, quantityCompleted: 0, defectQuantity: 0 });
  assert.throws(() => validateScanQuantities({ action: "start", hours_worked: -1 }), /hours_worked/);
});


test("TIMER.3 超过 72h 未结束标记 stale，不把历史时间算入", () => {
  const db = makeDb();
  db.prepare("INSERT INTO work_orders (id,status,actual_start) VALUES (2,'in_progress','2026-01-01 08:00:00')").run();
  db.prepare("INSERT INTO work_order_operations (work_order_id,action,timestamp) VALUES (2,'start','2026-01-01 08:00:00')").run();
  const result = recalcWorkOrderTimer(db, 2);
  assert.equal(result.timer_status, "stale");
  assert.equal(result.actual_duration_seconds, 0);
  assert.equal(result.timer_started_at, null);
  db.close();
});
