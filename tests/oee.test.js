"use strict";
// tests/oee.test.js（2026-11-05 审计整改后更新）
// 覆盖：空工位 0%、工位 busy 摊销、跨天任务按工时比例、班次×人数可用工时、窗口默认近 N 天。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const path = require("path");
const svcPath = path.resolve(__dirname, "../services/equipment/oee.js");

function makeDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, workshop TEXT, shift TEXT, max_workers INTEGER)");
  db.exec("CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT)");
  db.exec("CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, estimated_hours REAL DEFAULT 0, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT, required_workstation_id INTEGER)");
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) {
    app[method] = (route, ...handlers) => routes.set(method.toUpperCase() + " " + route, handlers);
  }
  return { app, routes };
}

function call(routes, method, route, query) {
  const handlers = routes.get(method.toUpperCase() + " " + route);
  assert.ok(handlers, "no route: " + route);
  let status = 200;
  let body = null;
  const res = { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } };
  handlers[0]({ query: query || {}, body: {}, params: {} }, res);
  return { status, body };
}

function load(db, query) {
  const { app, routes } = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  return call(routes, "get", "/api/equipment/oee", query);
}

test("OEE.1 7 工位无任务：可用工时 = 7 × 天数 × 8h（班次默认白班），利用率 0", () => {
  const db = makeDb();
  for (let i = 1; i <= 7; i++) db.prepare("INSERT INTO workstations (id, name) VALUES (?, ?)").run(i, `WS${i}`);
  const r = load(db, { days: "7", start_date: "2026-07-01" });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.workstation_count, 7);
  assert.equal(r.body.summary.fleet_available_hours, 7 * 7 * 8);
  assert.equal(r.body.summary.fleet_utilization_pct, 0);
  assert.equal(r.body.capacity_basis, "shift_workers");
  db.close();
});

test("OEE.2 单日 4h 任务：busy=4h，利用率按 8h/天 计算", () => {
  const db = makeDb();
  db.prepare("INSERT INTO workstations (id, name) VALUES (1, '激光')").run();
  db.prepare("INSERT INTO equipment_instances (id, instance_code) VALUES (1, 'T1')").run();
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name, estimated_hours, planned_start, planned_end, required_workstation_id) VALUES (1, '切割', 4, '2026-07-01 00:00:00', '2026-07-01 04:00:00', 1)").run();
  const r = load(db, { days: "2", start_date: "2026-07-01" });
  assert.equal(r.body.workstations[0].busy_hours, 4);
  assert.equal(r.body.workstations[0].available_hours, 16);
  assert.equal(r.body.workstations[0].utilization_pct, 25);
  db.close();
});

test("OEE.3 跨天任务按工时比例摊销（不再按日历小时 × 24 高估）", () => {
  const db = makeDb();
  db.prepare("INSERT INTO workstations (id, name) VALUES (1, '激光')").run();
  db.prepare("INSERT INTO equipment_instances (id, instance_code) VALUES (1, 'T1')").run();
  // 8h 工时、计划跨 48h（2 天）；窗口覆盖整个跨度 → busy 应接近 8h 而不是 48h
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name, estimated_hours, planned_start, planned_end, required_workstation_id) VALUES (1, '长任务', 8, '2026-07-01 00:00:00', '2026-07-03 00:00:00', 1)").run();
  const r = load(db, { days: "2", start_date: "2026-07-01" });
  assert.equal(r.body.workstations[0].busy_hours, 8);
  db.close();
});

test("OEE.4 双班 + 2 人：可用工时 = min(24, 16×2)=24h/天", () => {
  const db = makeDb();
  db.prepare("INSERT INTO workstations (id, name, shift, max_workers) VALUES (1, '总装', 'two', 2)").run();
  const r = load(db, { days: "3", start_date: "2026-07-01" });
  assert.equal(r.body.workstations[0].daily_capacity_hours, 24);
  assert.equal(r.body.workstations[0].available_hours, 3 * 24);
  db.close();
});

test("OEE.5 默认窗口是「近 N 天」（不以未来计划为统计对象）", () => {
  const db = makeDb();
  db.prepare("INSERT INTO workstations (id, name) VALUES (1, '激光')").run();
  const r = load(db, { days: "5" });
  const start = new Date(r.body.start_date + "T00:00:00Z");
  const end = new Date(r.body.end_date + "T00:00:00Z");
  const today = new Date(r.body.today + "T00:00:00Z");
  assert.equal(r.body.window.mode, "past");
  assert.equal((end - start) / 86400000, 5);
  assert.ok(end > today, "窗口应覆盖到今天");
  assert.ok(start < today, "窗口起点在今天之前（历史区间）");
  db.close();
});

test("OEE.6 显式 start_date 走 explicit 模式，回看历史", () => {
  const db = makeDb();
  db.prepare("INSERT INTO workstations (id, name) VALUES (1, '激光')").run();
  const r = load(db, { days: "7", start_date: "2026-06-01" });
  assert.equal(r.body.window.mode, "explicit");
  assert.equal(r.body.start_date, "2026-06-01");
  assert.equal(r.body.end_date, "2026-06-08");
  db.close();
});
