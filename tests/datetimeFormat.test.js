"use strict";
// tests/datetimeFormat.test.js
// 2026-11-05（审计 F-08）：时间字符串统一（空格分隔、本地时区、无 T/Z）。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  formatSqlDate,
  formatSqlDateTime,
  nowSqlDateTime,
  normalizeSqlDateTime,
  todaySqlDate,
} = require("../shared/datetime");

const registerRoutes2 = require("../services/schedule/routes/routes_2");

test("DT.1 formatSqlDate / formatSqlDateTime 用本地日期（不用 UTC）", () => {
  const date = new Date(2026, 10, 5, 8, 9, 10);
  assert.equal(formatSqlDate(date), "2026-11-05");
  assert.equal(formatSqlDateTime(date), "2026-11-05 08:09:10");
  // 凌晨时间不应被 UTC 减一天
  const earlyMorning = new Date(2026, 0, 1, 1, 2, 3);
  assert.equal(formatSqlDate(earlyMorning), "2026-01-01");
});

test("DT.2 normalizeSqlDateTime：ISO 带 T/Z、毫秒、空格、纯日期都能归一", () => {
  assert.equal(normalizeSqlDateTime("2026-11-05T12:34:56.789Z"), "2026-11-05 12:34:56");
  assert.equal(normalizeSqlDateTime("2026-11-05T12:34:56Z"), "2026-11-05 12:34:56");
  assert.equal(normalizeSqlDateTime("2026-11-05 12:34:56"), "2026-11-05 12:34:56");
  assert.equal(normalizeSqlDateTime("2026-11-05 12:34"), "2026-11-05 12:34:00");
  assert.equal(normalizeSqlDateTime("2026-11-05"), "2026-11-05", "纯日期保持");
  assert.equal(normalizeSqlDateTime("  2026-11-05T00:00:00.000Z  "), "2026-11-05 00:00:00");
  assert.equal(normalizeSqlDateTime(null), null);
  assert.equal(normalizeSqlDateTime(""), null);
  assert.equal(normalizeSqlDateTime(new Date(2026, 10, 5, 8, 9, 10)), "2026-11-05 08:09:10");
});

test("DT.3 nowSqlDateTime / todaySqlDate 格式正确", () => {
  assert.match(nowSqlDateTime(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(todaySqlDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("DT.4 工序状态接口写入的实际时间不带 T（回归）", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, sequence INTEGER,
      status TEXT, phase_code TEXT, planned_start TEXT, planned_end TEXT, estimated_hours REAL,
      subsystem_id INTEGER, assigned_to INTEGER, required_workstation_id INTEGER,
      actual_start TEXT, actual_end TEXT, updated_at TEXT
    );
    CREATE TABLE schedule_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, status TEXT, updated_at TEXT
    );
    INSERT INTO process_nodes (id, operation_name, status) VALUES (1, '下料', 'pending');
  `);
  const routes = new Map();
  const app = { get: (p, ...h) => routes.set("GET " + p, h), put: (p, ...h) => routes.set("PUT " + p, h) };
  const ctx = {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
  registerRoutes2(app, db, ctx);
  const handler = routes.get("PUT /api/schedule/process-nodes/:id/status").slice(-1)[0];
  let error = null;
  handler({ params: { id: "1" }, body: { status: "completed" }, query: {}, user: { sub: 1 } }, { json() {} }, (err) => { error = err; });
  assert.equal(error, null);
  const row = db.prepare("SELECT actual_start, actual_end FROM process_nodes WHERE id = 1").get();
  assert.match(row.actual_start, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "actual_start 应为空格分隔本地时间");
  assert.match(row.actual_end, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(!row.actual_start.includes("T"));
  db.close();
});
