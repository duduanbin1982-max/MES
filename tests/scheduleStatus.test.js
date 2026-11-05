"use strict";
// tests/scheduleStatus.test.js
// 2026-11-05（项目排程审计 F-04）：工序状态流转校验（禁止已完成回退 / 非法跳转）。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const registerRoutes2 = require("../services/schedule/routes/routes_2");

function makeDb() {
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
    INSERT INTO process_nodes (id, operation_name, status, actual_start, actual_end) VALUES
      (1, '待开始', 'pending', NULL, NULL),
      (2, '已完成', 'completed', '2026-11-01 08:00:00', '2026-11-02 08:00:00'),
      (3, '进行中', 'in_progress', '2026-11-01 08:00:00', NULL);
    INSERT INTO schedule_assignments (process_node_id, status) VALUES (1, 'assigned'), (3, 'in_progress');
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

function call(routes, method, path, { params = {}, body = {} } = {}) {
  const handlers = routes.get(`${method} ${path}`);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(value) { payload = { status: code, body: value }; } }; },
    json(value) { payload = { status: 200, body: value }; },
  };
  handler({ params, body, query: {}, user: { sub: 1 } }, res, (err) => { error = err; });
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
  registerRoutes2(app, db, ctx);
  return { db, routes };
}

test("ST.1 合法流转：pending → in_progress 回填 actual_start", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "PUT", "/api/schedule/process-nodes/:id/status", { params: { id: "1" }, body: { status: "in_progress" } });
  assert.equal(error, null);
  assert.equal(payload.body.status, "in_progress");
  const row = db.prepare("SELECT status, actual_start FROM process_nodes WHERE id = 1").get();
  assert.equal(row.status, "in_progress");
  assert.ok(row.actual_start);
  assert.equal(db.prepare("SELECT status FROM schedule_assignments WHERE process_node_id = 1").get().status, "in_progress");
  db.close();
});

test("ST.2 禁止已完成回退（completed → in_progress / pending / blocked）", () => {
  const { db, routes } = fresh();
  for (const status of ["in_progress", "pending", "blocked"]) {
    const { error } = call(routes, "PUT", "/api/schedule/process-nodes/:id/status", { params: { id: "2" }, body: { status } });
    assert.ok(error, `${status} 应被拒`);
    assert.equal(error.status, 400);
  }
  const row = db.prepare("SELECT status, actual_end FROM process_nodes WHERE id = 2").get();
  assert.equal(row.status, "completed");
  assert.ok(row.actual_end, "历史实际时间不被清空");
  db.close();
});

test("ST.3 pending 可直接报完工（短任务），自动补 actual_start/actual_end", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "PUT", "/api/schedule/process-nodes/:id/status", { params: { id: "1" }, body: { status: "completed" } });
  assert.equal(error, null);
  assert.equal(payload.body.status, "completed");
  const row = db.prepare("SELECT status, actual_start, actual_end FROM process_nodes WHERE id = 1").get();
  assert.equal(row.status, "completed");
  assert.ok(row.actual_start && row.actual_end, "完成时补实际起止");
  db.close();
});

test("ST.4 同状态幂等返回 unchanged，不重复写实际时间", () => {
  const { db, routes } = fresh();
  const { payload } = call(routes, "PUT", "/api/schedule/process-nodes/:id/status", { params: { id: "3" }, body: { status: "in_progress" } });
  assert.equal(payload.body.unchanged, true);
  const row = db.prepare("SELECT actual_start FROM process_nodes WHERE id = 3").get();
  assert.equal(row.actual_start, "2026-11-01 08:00:00");
  db.close();
});

test("ST.5 in_progress → completed 正常，完成时回填 actual_end", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "PUT", "/api/schedule/process-nodes/:id/status", { params: { id: "3" }, body: { status: "completed" } });
  assert.equal(error, null);
  assert.equal(payload.body.status, "completed");
  const row = db.prepare("SELECT status, actual_start, actual_end FROM process_nodes WHERE id = 3").get();
  assert.equal(row.status, "completed");
  assert.equal(row.actual_start, "2026-11-01 08:00:00");
  assert.ok(row.actual_end);
  db.close();
});
