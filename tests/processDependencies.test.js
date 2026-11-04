"use strict";
// tests/processDependencies.test.js
// 2026-11-05：工艺依赖维护（列表 / 新增 / 改类型与间隔 / 删除）
// 覆盖：列表 join 名称与节点选项、各种校验（必填/自依赖/跨项目/重复/类型/lag）、环检测、PUT 重校验、DELETE。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const dependenciesModule = require("../services/process/node/dependencies");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      operation_name TEXT,
      status TEXT,
      planned_start TEXT,
      planned_end TEXT,
      sequence INTEGER
    );
    CREATE TABLE process_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      predecessor_id INTEGER,
      successor_id INTEGER,
      dep_type TEXT DEFAULT 'FS',
      lag_hours REAL DEFAULT 0,
      created_at TEXT
    );
    INSERT INTO process_nodes (id, equipment_instance_id, operation_name, status, planned_start, planned_end, sequence) VALUES
      (1, 10, '下料', 'ready', '2026-11-10', '2026-11-10 04:00:00', 1),
      (2, 10, '卷制', 'pending', '2026-11-11', '2026-11-12 08:00:00', 2),
      (3, 10, '焊接', 'pending', '2026-11-13', '2026-11-14 08:00:00', 3),
      (4, 20, '总装', 'pending', '2026-12-01', '2026-12-05', 1);
    INSERT INTO process_dependencies (id, equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours) VALUES
      (1, 10, 1, 2, 'FS', 0);
  `);
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    post: (path, ...handlers) => routes.set("POST " + path, handlers),
    put: (path, ...handlers) => routes.set("PUT " + path, handlers),
    delete: (path, ...handlers) => routes.set("DELETE " + path, handlers),
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

function setup() {
  const db = freshDb();
  const { app, routes } = makeApp();
  dependenciesModule.register(app, db);
  return { db, routes };
}

test("PD.1 列表：join 工序名称 + 返回该项目的节点选项", () => {
  const { db, routes } = setup();
  const result = call(routes, "GET", "/api/process_dependencies", { query: { instance_id: "10" } });
  assert.equal(result.error, null);
  const body = result.payload.body;
  assert.equal(body.total, 1);
  assert.equal(body.items[0].predecessor_name, "下料");
  assert.equal(body.items[0].successor_name, "卷制");
  assert.equal(body.nodes.length, 3, "只返回该项目 3 个工序");
  assert.deepEqual(body.nodes.map((node) => node.id), [1, 2, 3]);

  const byPredecessor = call(routes, "GET", "/api/process_dependencies", { query: { predecessor_id: "2" } });
  assert.equal(byPredecessor.payload.body.total, 0);
  db.close();
});

test("PD.2 新增校验：必填 / 自依赖 / 跨项目 / 重复 / 类型 / lag", () => {
  const { db, routes } = setup();
  const missing = call(routes, "POST", "/api/process_dependencies", { body: {} });
  assert.equal(missing.error.status, 400);

  const self = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 1, successor_id: 1 } });
  assert.equal(self.error.status, 400);
  assert.match(String(self.error.message), /自己/);

  const crossProject = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 1, successor_id: 4 } });
  assert.equal(crossProject.error.status, 400);
  assert.match(String(crossProject.error.message), /同一个项目/);

  const duplicate = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 1, successor_id: 2 } });
  assert.equal(duplicate.error.status, 400);
  assert.match(String(duplicate.error.message), /已存在/);

  const badType = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 3, dep_type: "XX" } });
  assert.equal(badType.error.status, 400);
  assert.match(String(badType.error.message), /dep_type/);

  const badLag = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 3, lag_hours: -1 } });
  assert.equal(badLag.error.status, 400);

  const tooBig = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 3, lag_hours: 99999 } });
  assert.equal(tooBig.error.status, 400);
  db.close();
});

test("PD.3 环检测：反向依赖被拒（1→2 已存在，2→1 拒绝）", () => {
  const { db, routes } = setup();
  const cycle = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 1 } });
  assert.equal(cycle.error.status, 400);
  assert.match(String(cycle.error.message), /循环依赖/);

  // 长链 A→B→C 后，C→A 也要拒绝
  const addBC = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 3 } });
  assert.equal(addBC.error, null);
  const longCycle = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 3, successor_id: 1 } });
  assert.equal(longCycle.error.status, 400);
  assert.match(String(longCycle.error.message), /循环依赖/);
  db.close();
});

test("PD.4 新增成功：instance 可从工序推导，lag 小数保留", () => {
  const { db, routes } = setup();
  const created = call(routes, "POST", "/api/process_dependencies", {
    body: { predecessor_id: 2, successor_id: 3, dep_type: "ss", lag_hours: 7.5 },
  });
  assert.equal(created.error, null);
  assert.equal(created.payload.body.equipment_instance_id, 10);
  assert.equal(created.payload.body.dep_type, "SS");
  assert.equal(created.payload.body.lag_hours, 7.5);
  const row = db.prepare("SELECT * FROM process_dependencies WHERE id = ?").get(created.payload.body.id);
  assert.equal(row.lag_hours, 7.5);
  db.close();
});

test("PD.5 修改：改类型/间隔；改端点要重新做环检测；不存在 404", () => {
  const { db, routes } = setup();
  const updated = call(routes, "PUT", "/api/process_dependencies/:id", {
    params: { id: "1" }, body: { dep_type: "FF", lag_hours: 16 },
  });
  assert.equal(updated.error, null);
  const row = db.prepare("SELECT * FROM process_dependencies WHERE id = 1").get();
  assert.equal(row.dep_type, "FF");
  assert.equal(row.lag_hours, 16);

  // 先加 2→3，再把 2→3 改成 2→1：1→2 已存在，会形成 1→2→1 环，拒绝
  const addBC = call(routes, "POST", "/api/process_dependencies", { body: { predecessor_id: 2, successor_id: 3 } });
  assert.equal(addBC.error, null);
  const cycle = call(routes, "PUT", "/api/process_dependencies/:id", {
    params: { id: String(addBC.payload.body.id) }, body: { predecessor_id: 2, successor_id: 1 },
  });
  assert.equal(cycle.error.status, 400);
  assert.match(String(cycle.error.message), /循环依赖/);

  const missing = call(routes, "PUT", "/api/process_dependencies/:id", { params: { id: "999" }, body: { lag_hours: 1 } });
  assert.equal(missing.error.status, 404);
  db.close();
});

test("PD.6 删除：成功与不存在", () => {
  const { db, routes } = setup();
  const deleted = call(routes, "DELETE", "/api/process_dependencies/:id", { params: { id: "1" } });
  assert.deepEqual(deleted.payload.body.deleted, [1]);
  const again = call(routes, "DELETE", "/api/process_dependencies/:id", { params: { id: "1" } });
  assert.equal(again.error.status, 404);
  db.close();
});
