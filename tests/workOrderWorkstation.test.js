"use strict";
// tests/workOrderWorkstation.test.js
// P2-1 遗留（2026-10-19）：工单级改派 —— PUT /api/work_orders/:id/workstation

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const workOrderService = require("../services/workOrderService");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, title TEXT, workstation_id INTEGER,
      equipment_instance_id INTEGER, milestone_id INTEGER, subsystem_id INTEGER, parent_wo_id INTEGER,
      description TEXT, priority TEXT, status TEXT, planned_start TEXT, planned_end TEXT,
      actual_start TEXT, actual_end TEXT, estimated_hours REAL, actual_hours REAL,
      created_at TEXT, updated_at TEXT, assigned_to INTEGER, dispatched_at TEXT,
      quantity_planned INTEGER, quantity_completed INTEGER);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER);
    INSERT INTO workstations VALUES (3, '焊接工位 1', 1), (5, '镗孔工位', 1), (9, '停用工位', 0);
    INSERT INTO work_orders (id, wo_code, title, workstation_id, equipment_instance_id, status)
      VALUES (2, 'WO-2', '前盾焊接', 3, 1, 'completed');
  `);
  return db;
}

function captureRoutes(db) {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    put: (path, ...handlers) => routes.set("PUT " + path, handlers),
    post: (path, ...handlers) => routes.set("POST " + path, handlers),
    patch: (path, ...handlers) => routes.set("PATCH " + path, handlers),
    delete: (path, ...handlers) => routes.set("DELETE " + path, handlers),
  };
  const auth = new Proxy({}, { get: () => (req, res, next) => next && next() });
  workOrderService.register(app, db, auth);
  return routes;
}

function invoke(routes, method, path, req) {
  const handlers = routes.get(method + " " + path);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(body) { payload = { status: code, body }; } }; },
    json(body) { payload = { status: 200, body }; },
  };
  return Promise.resolve(handler(req, res, (err) => { error = err; }))
    .then(() => ({ payload, error }));
}

test("WW.1 工单改派：成功改到目标工位", async () => {
  const db = freshDb();
  const routes = captureRoutes(db);
  const { payload, error } = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", {
    params: { id: "2" }, body: { workstation_id: 5 },
  });
  assert.equal(error, null);
  assert.equal(payload.body.changed, 1);
  assert.equal(payload.body.workstation_id, 5);
  assert.equal(payload.body.previous_workstation_id, 3);
  assert.equal(db.prepare("SELECT workstation_id FROM work_orders WHERE id = 2").get().workstation_id, 5);
  db.close();
});

test("WW.2 同工位：changed=0，不写库", async () => {
  const db = freshDb();
  const routes = captureRoutes(db);
  const before = db.prepare("SELECT updated_at FROM work_orders WHERE id = 2").get().updated_at;
  const { payload } = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", {
    params: { id: "2" }, body: { workstation_id: 3 },
  });
  assert.equal(payload.body.changed, 0);
  assert.equal(db.prepare("SELECT updated_at FROM work_orders WHERE id = 2").get().updated_at, before);
  db.close();
});

test("WW.3 缺 workstation_id → 400", async () => {
  const db = freshDb();
  const routes = captureRoutes(db);
  const { error } = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", { params: { id: "2" }, body: {} });
  assert.ok(error, "应抛 ApiError");
  assert.equal(error.status, 400);
  db.close();
});

test("WW.4 工单不存在 / 工位不存在 → 404；停用工位 → 400", async () => {
  const db = freshDb();
  const routes = captureRoutes(db);
  const missingWo = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", { params: { id: "999" }, body: { workstation_id: 5 } });
  assert.equal(missingWo.error.status, 404);
  const missingWs = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", { params: { id: "2" }, body: { workstation_id: 404 } });
  assert.equal(missingWs.error.status, 404);
  const inactive = await invoke(routes, "PUT", "/api/work_orders/:id/workstation", { params: { id: "2" }, body: { workstation_id: 9 } });
  assert.equal(inactive.error.status, 400);
  assert.match(String(inactive.error.message), /停用/);
  db.close();
});
