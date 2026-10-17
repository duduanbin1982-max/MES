"use strict";
// tests/workOrder.test.js
// P0 characterization tests for workOrderService (brooks-audit R6 fix)
// Tests lock down CURRENT behavior before refactor in F4 (state machine dedup).

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const workOrderService = require("../services/workOrderService");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      full_name TEXT,
      role TEXT
    );
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY,
      instance_code TEXT,
      instance_name,
      status TEXT
    );
    CREATE TABLE equipment_subsystems (
      id INTEGER PRIMARY KEY,
      instance_id INTEGER,
      name_zh TEXT
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY,
      wo_code TEXT NOT NULL,
      equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER,
      subsystem_id INTEGER,
      title TEXT NOT NULL,
      workstation_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 3,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      estimated_hours REAL,
      actual_hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_to INTEGER,
      dispatched_at TEXT,
      quantity_planned INTEGER DEFAULT 1,
      quantity_completed INTEGER DEFAULT 0
    );
    CREATE TABLE work_order_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      operator_id INTEGER,
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      hours_worked REAL,
      notes TEXT,
      photos TEXT,
      quantity_completed INTEGER DEFAULT 0,
      defect_quantity INTEGER DEFAULT 0
    );
    CREATE TABLE resource_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      workstation_id INTEGER,
      equipment_instance_id INTEGER,
      assigned_at TEXT DEFAULT (datetime('now')),
      released_at TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      work_order_id INTEGER
    );
    CREATE TABLE weld_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER,
      weld_no TEXT,
      welder_id INTEGER,
      material_lot_id INTEGER,
      weld_length_mm INTEGER
    );
    INSERT INTO users (id, username, full_name, role) VALUES (1, 'foreman1', '???', 'foreman');
    INSERT INTO users (id, username, full_name, role) VALUES (2, 'worker1', '???', 'worker');
    INSERT INTO equipment_instances (id, instance_code, instance_name, status)
      VALUES (1, 'TBM-001', '????', 'assembly');
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status)
      VALUES (1, 'WO-001', 1, '????', 'pending');
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status, quantity_planned)
      VALUES (2, 'WO-002', 1, '????', 'dispatched', 5);
  `);
  return db;
}

// Test-mock auth: mirrors production guards (brooks-audit F5). These all pass in tests.
function createAuth(db) {
  return {
    onlyForemanOrAdmin: (req, _res, next) => { req.user = { sub: 1, role: 'foreman' }; next(); },
    onlyWelder: (req, _res, next) => { req.user = { sub: 2, role: 'welder' }; next(); },
    foremanOrWorker: (req, _res, next) => { req.user = { sub: 2, role: 'worker' }; next(); },
  };
}

function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    app[method] = (route, ...handlers) => {
      const key = method.toUpperCase() + " " + route;
      const existing = routes.get(key) || [];
      existing.push(...handlers);
      routes.set(key, existing);
    };
  }
  workOrderService.register(app, db, createAuth(db));
  return (method, route) => {
    const chain = routes.get(method.toUpperCase() + " " + route);
    if (!chain) throw new Error("No route: " + method + " " + route);
    return chain;
  };
}

async function invoke(handlers, request = {}) {
  const req = { params: {}, query: {}, body: {}, ...request };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let i = 0;
  await new Promise((resolve, reject) => {
    const next = (err) => {
      if (err) return reject(err);
      const h = handlers[i++];
      if (!h) return resolve();
      let advanced = false;
      const advance = (e) => {
        if (advanced) return;
        advanced = true;
        if (e) return reject(e);
        try { next(e); } catch (ex) { reject(ex); }
      };
      try {
        const result = h(req, res, advance);
        if (result && typeof result.then === "function") {
          result.then(() => advance(), advance);
        }
      } catch (e) {
        reject(e);
      }
    };
    next();
  });
  return { req, res, status: res.statusCode, body: res.body };
}

async function runHandler(app, method, route, request) {
  const handlers = app(method, route);
  return invoke(handlers, request);
}

// ===== F-T1 characterization tests =====

test("F-T1.1: POST /:id/operations action=start transitions WO pending -> in_progress and writes actual_start", async () => {
  const db = createDatabase();
  const app = createApp(db);

  await runHandler(app, "POST", "/api/work_orders/:id/operations", {
    params: { id: 1 },
    body: { operator_id: 2, action: "start", hours_worked: 0.5, notes: "????" },
  });

  const wo = db.prepare("SELECT status, actual_start FROM work_orders WHERE id = 1").get();
  assert.equal(wo.status, "in_progress");
  assert.ok(wo.actual_start, "actual_start should be set");
  const ops = db.prepare("SELECT action FROM work_order_operations WHERE work_order_id = 1").all();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].action, "start");
  db.close();
});

test("F-T1.2: PUT /:id/dispatch moves pending WO to dispatched and inserts resource_allocations", async () => {
  const db = createDatabase();
  const app = createApp(db);

  await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", {
    params: { id: 1 },
    body: { user_id: 2, workstation_id: 10, planned_start: "2026-07-26", notes: "??????" },
  });

  const wo = db.prepare("SELECT status, assigned_to, dispatched_at FROM work_orders WHERE id = 1").get();
  assert.equal(wo.status, "dispatched");
  assert.equal(wo.assigned_to, 2);
  assert.ok(wo.dispatched_at, "dispatched_at should be set");

  const alloc = db.prepare("SELECT user_id, work_order_id, status FROM resource_allocations WHERE work_order_id = 1").all();
  assert.equal(alloc.length, 1);
  assert.equal(alloc[0].user_id, 2);
  assert.equal(alloc[0].status, "active");
  db.close();
});

test("F-T1.3: POST /:id/report when qty reaches quantity_planned moves WO to completed and writes actual_end", async () => {
  const db = createDatabase();
  const app = createApp(db);

  await runHandler(app, "POST", "/api/work_orders/:id/report", {
    params: { id: 2 },
    body: { user_id: 2, hours_worked: 4.5, quantity_completed: 5, defect_quantity: 0 },
  });

  const wo = db.prepare("SELECT status, quantity_completed, actual_hours, actual_end FROM work_orders WHERE id = 2").get();
  assert.equal(wo.status, "completed");
  assert.equal(wo.quantity_completed, 5);
  assert.equal(wo.actual_hours, 4.5);
  assert.ok(wo.actual_end, "actual_end should be set when qty reaches planned");

  const ops = db.prepare("SELECT action FROM work_order_operations WHERE work_order_id = 2").all();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].action, "report");
  db.close();
});

// ===== F5: authorization guards =====

test("F5.1: PUT /:id/dispatch rejects when user role is not in foreman/admin", async () => {
  const db = createDatabase();
createApp(db);
  // Override auth to simulate a viewer role attempting dispatch
  const viewerAuth = {
    onlyForemanOrAdmin: (_req, _res, next) => next(new Error("forbidden")),
    onlyWelder: (_req, _res, next) => next(),
    foremanOrWorker: (_req, _res, next) => next(),
  };
  const routes = new Map();
  const vApp = {};
  for (const method of ["get", "post", "put", "delete"]) {
    vApp[method] = (route, ...handlers) => {
      const key = method.toUpperCase() + " " + route;
      const existing = routes.get(key) || [];
      existing.push(...handlers);
      routes.set(key, existing);
    };
  }
  workOrderService.register(vApp, db, viewerAuth);
  const handlers = routes.get("PUT /api/work_orders/:id/dispatch");
  await assert.rejects(
    invoke(handlers, { params: { id: 1 }, body: { user_id: 2 } }),
    /forbidden/
  );
  const wo = db.prepare("SELECT status FROM work_orders WHERE id = 1").get();
  assert.equal(wo.status, "pending", "WO status should not change when dispatch is rejected");
  db.close();
});
