"use strict";
// tests/scheduleWeekly.test.js
// 2026-11-05（项目排程审计 F-01/F-02）：周窗口按本地日期（周一~周日）+ 只返回本周计划与未排程。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const registerRoutes1 = require("../services/schedule/routes/routes_1");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, sequence INTEGER,
      status TEXT, phase_code TEXT, planned_start TEXT, planned_end TEXT, estimated_hours REAL,
      subsystem_id INTEGER, assigned_to INTEGER, required_workstation_id INTEGER, updated_at TEXT
    );
    INSERT INTO equipment_instances VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机');
    INSERT INTO process_nodes (id, equipment_instance_id, operation_name, sequence, status, planned_start, planned_end) VALUES
      (1, 1, '本周任务A', 1, 'pending', '2026-11-03', '2026-11-04'),
      (2, 1, '本周完成B', 2, 'completed', '2026-11-02', '2026-11-03'),
      (3, 1, '上周任务C', 3, 'pending', '2026-10-28', '2026-10-30'),
      (4, 1, '下周任务D', 4, 'pending', '2026-11-16', '2026-11-18'),
      (5, 1, '未排程E', 5, 'ready', NULL, NULL),
      (6, 2, '别项目本周F', 1, 'in_progress', '2026-11-06', '2026-11-07');
  `);
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    put: (path, ...handlers) => routes.set("PUT " + path, handlers),
  };
  return { app, routes };
}

function call(routes, method, path, { params = {}, body = {}, query = {} } = {}) {
  const handlers = routes.get(`${method} ${path}`);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(value) { payload = { status: code, body: value }; } }; },
    json(value) { payload = { status: 200, body: value }; },
  };
  handler({ params, body, query, user: { sub: 1 } }, res, (err) => { error = err; });
  return { payload, error };
}

function fresh() {
  const db = makeDb();
  const { app, routes } = makeApp();
  const ctx = {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
  registerRoutes1(app, db, ctx);
  return { db, routes };
}

test("WEEK.1 周窗口按本地日期：2026-11-05（周四）→ 11-02 ~ 11-08", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "GET", "/api/schedule/weekly", { query: { date: "2026-11-05" } });
  assert.equal(error, null);
  assert.equal(payload.body.week_start, "2026-11-02", "周一（原实现用 toISOString 会变成 11-01 周日）");
  assert.equal(payload.body.week_end, "2026-11-08", "周日（原实现为 11-07）");
  db.close();
});

test("WEEK.2 周日/周一作为输入都归到同一周", () => {
  const { db, routes } = fresh();
  const sunday = call(routes, "GET", "/api/schedule/weekly", { query: { date: "2026-11-08" } }).payload.body;
  const monday = call(routes, "GET", "/api/schedule/weekly", { query: { date: "2026-11-02" } }).payload.body;
  assert.equal(sunday.week_start, "2026-11-02");
  assert.equal(monday.week_start, "2026-11-02");
  db.close();
});

test("WEEK.3 只返回本周计划 + 未排程，不再返回全部 backlog", () => {
  const { db, routes } = fresh();
  const body = call(routes, "GET", "/api/schedule/weekly", { query: { date: "2026-11-05" } }).payload.body;
  const names = body.equipment.flatMap((e) => e.nodes).map((n) => n.operation_name).sort();
  assert.deepEqual(names, ["本周任务A", "本周完成B", "别项目本周F", "未排程E"].sort());
  assert.ok(!names.includes("上周任务C"), "上周任务不应出现");
  assert.ok(!names.includes("下周任务D"), "下周任务不应出现");
  assert.equal(body.scope, "week+unscheduled");
  db.close();
});

test("WEEK.4 summary 与项目进度按周范围统计", () => {
  const { db, routes } = fresh();
  const body = call(routes, "GET", "/api/schedule/weekly", { query: { date: "2026-11-05" } }).payload.body;
  assert.equal(body.summary.total, 4);
  assert.equal(body.summary.completed, 1);
  assert.equal(body.summary.in_progress, 1);
  assert.equal(body.summary.unscheduled, 1);
  const tbm1 = body.equipment.find((e) => e.instance_code === "TBM-1");
  assert.equal(tbm1.nodes.length, 3);
  assert.equal(tbm1.progress_pct, 33, "1 完成 / 3 条本周范围");
  db.close();
});

test("WEEK.5 非法日期被拒", () => {
  const { db, routes } = fresh();
  const { error } = call(routes, "GET", "/api/schedule/weekly", { query: { date: "11/05" } });
  assert.ok(error);
  assert.equal(error.status, 400);
  db.close();
});
