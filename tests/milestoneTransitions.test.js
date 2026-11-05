"use strict";
// tests/milestoneTransitions.test.js
// 2026-11-05（项目排程审计 F-05）：里程碑状态流转校验 + 本地日期自动回填。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { register } = require("../services/reportService/milestones");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE instance_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, phase_code TEXT, phase_name TEXT,
      sequence INTEGER, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      status TEXT, notes TEXT
    );
    INSERT INTO instance_milestones (id, equipment_instance_id, phase_code, phase_name, sequence, planned_start, status)
    VALUES (1, 1, 'S1', '设计冻结', 1, '2026-07-01', 'pending'),
           (2, 1, 'S2', '采购', 2, '2026-07-01', 'completed');
  `);
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (p, ...h) => routes.set("GET " + p, h),
    post: (p, ...h) => routes.set("POST " + p, h),
    put: (p, ...h) => routes.set("PUT " + p, h),
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
  register(app, db);
  return { db, routes };
}

test("MS.1 pending → active：自动回填本地日期 actual_start", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "PUT", "/api/milestones/:id", { params: { id: "1" }, body: { status: "active" } });
  assert.equal(error, null);
  assert.equal(payload.body.milestone.status, "active");
  assert.match(String(payload.body.milestone.actual_start), /^\d{4}-\d{2}-\d{2}$/, "本地日期 YYYY-MM-DD");
  db.close();
});

test("MS.2 禁止跳过：pending → completed 被拒", () => {
  const { db, routes } = fresh();
  const { error } = call(routes, "PUT", "/api/milestones/:id", { params: { id: "1" }, body: { status: "completed" } });
  assert.ok(error);
  assert.equal(error.status, 400);
  assert.match(String(error.message), /不能从/);
  db.close();
});

test("MS.3 completed 不可回退", () => {
  const { db, routes } = fresh();
  for (const status of ["active", "pending"]) {
    const { error } = call(routes, "PUT", "/api/milestones/:id", { params: { id: "2" }, body: { status } });
    assert.ok(error, `${status} 应被拒`);
    assert.equal(error.status, 400);
  }
  db.close();
});

test("MS.4 active → completed：自动回填 actual_end", () => {
  const { db, routes } = fresh();
  call(routes, "PUT", "/api/milestones/:id", { params: { id: "1" }, body: { status: "active" } });
  const { payload, error } = call(routes, "PUT", "/api/milestones/:id", { params: { id: "1" }, body: { status: "completed" } });
  assert.equal(error, null);
  assert.equal(payload.body.milestone.status, "completed");
  assert.ok(payload.body.milestone.actual_end);
  db.close();
});

test("MS.5 只改备注不触发状态校验", () => {
  const { db, routes } = fresh();
  const { error } = call(routes, "PUT", "/api/milestones/:id", { params: { id: "2" }, body: { notes: "验收补记" } });
  assert.equal(error, null);
  assert.equal(db.prepare("SELECT notes FROM instance_milestones WHERE id = 2").get().notes, "验收补记");
  db.close();
});
