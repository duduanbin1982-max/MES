"use strict";
// tests/milestoneBackfill.test.js
// 2026-11-05（审计 F-09）：里程碑计划日期补齐（只补缺失、不覆盖已有）。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { register } = require("../services/reportService/milestones");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, planned_start TEXT, planned_end TEXT, start_date TEXT
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, planned_start TEXT, planned_end TEXT
    );
    CREATE TABLE instance_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, phase_code TEXT, phase_name TEXT,
      sequence INTEGER, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      status TEXT, notes TEXT
    );
    INSERT INTO equipment_instances (id, instance_code, instance_name, planned_start) VALUES (1, 'TBM-1', '一号机', '2026-07-01');
    INSERT INTO process_nodes (equipment_instance_id, planned_start, planned_end) VALUES
      (1, '2026-07-01', '2026-12-31');
    INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, sequence, planned_start, planned_end, status) VALUES
      (1, 'S1', '设计冻结', 1, '2026-07-01', NULL, 'pending'),
      (1, 'S2', '采购', 2, '2026-07-01', NULL, 'active'),
      (1, 'S3', '自制件生产', 3, NULL, NULL, 'pending'),
      (1, 'S4', '部件预装', 4, '2026-09-01', '2026-09-30', 'completed');
  `);
  return db;
}

function makeApp() {
  const routes = new Map();
  return {
    routes,
    app: {
      get: (p, ...h) => routes.set("GET " + p, h),
      post: (p, ...h) => routes.set("POST " + p, h),
      put: (p, ...h) => routes.set("PUT " + p, h),
    },
  };
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
  register(app, db);
  return { db, routes };
}

test("MSB.1 dryRun 预览：只列出缺失项，不写库", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "POST", "/api/equipment_instances/:id/milestones/backfill", {
    params: { id: "1" }, query: { dryRun: "1" },
  });
  assert.equal(error, null);
  assert.equal(payload.body.dry_run, true);
  assert.equal(payload.body.changed_count, 3, "S1/S2/S3 未完成需重排；S4 已完成保留");
  assert.equal(payload.body.updated, 0);
  const row = db.prepare("SELECT planned_end FROM instance_milestones WHERE phase_code = 'S1'").get();
  assert.equal(row.planned_end, null, "dryRun 不写库");
  db.close();
});

test("MSB.2 应用：补齐缺失计划起止，已完整的不覆盖", () => {
  const { db, routes } = fresh();
  const { payload, error } = call(routes, "POST", "/api/equipment_instances/:id/milestones/backfill", { params: { id: "1" } });
  assert.equal(error, null);
  assert.equal(payload.body.updated, 3);
  const rows = db.prepare("SELECT phase_code, planned_start, planned_end FROM instance_milestones ORDER BY sequence").all();
  for (const row of rows) {
    assert.match(String(row.planned_start), /^\d{4}-\d{2}-\d{2}$/, `${row.phase_code} planned_start`);
    assert.match(String(row.planned_end), /^\d{4}-\d{2}-\d{2}$/, `${row.phase_code} planned_end`);
    assert.ok(String(row.planned_end) >= String(row.planned_start), `${row.phase_code} 结束不早于开始`);
  }
  const s4 = rows.find((row) => row.phase_code === "S4");
  assert.equal(s4.planned_start, "2026-09-01", "已完成里程碑计划不被覆盖");
  assert.equal(s4.planned_end, "2026-09-30");
  db.close();
});

test("MSB.3 阶段按顺序、不重叠", () => {
  const { db, routes } = fresh();
  call(routes, "POST", "/api/equipment_instances/:id/milestones/backfill", { params: { id: "1" } });
  const rows = db.prepare("SELECT phase_code, planned_start, planned_end FROM instance_milestones ORDER BY sequence").all();
  const s1 = rows.find((row) => row.phase_code === "S1");
  const s2 = rows.find((row) => row.phase_code === "S2");
  const s3 = rows.find((row) => row.phase_code === "S3");
  assert.ok(s1.planned_end <= s2.planned_start, "S1 结束不晚于 S2 开始");
  assert.ok(s2.planned_end <= s3.planned_start, "S2 结束不晚于 S3 开始");
  db.close();
});

test("MSB.4 实例不存在 404 / 无里程碑返回 0", () => {
  const { db, routes } = fresh();
  const missing = call(routes, "POST", "/api/equipment_instances/:id/milestones/backfill", { params: { id: "999" } });
  assert.equal(missing.error.status, 404);
  db.prepare("DELETE FROM instance_milestones").run();
  const empty = call(routes, "POST", "/api/equipment_instances/:id/milestones/backfill", { params: { id: "1" } });
  assert.equal(empty.payload.body.updated, 0);
  db.close();
});
