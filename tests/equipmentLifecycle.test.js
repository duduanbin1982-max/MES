"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const path = require("path");

const svcPath = path.resolve(__dirname, "../services/equipment/service.js");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY,
      instance_code TEXT,
      instance_name TEXT,
      status TEXT,
      lifecycle_stage TEXT,
      updated_at TEXT
    );
    CREATE TABLE equipment_models (id INTEGER PRIMARY KEY);
    CREATE TABLE equipment_types (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1);
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, sequence INTEGER);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY);
    CREATE TABLE equipment (id INTEGER PRIMARY KEY);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT, workstation_id INTEGER, actual_start TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, unit_price REAL, quantity REAL, is_key_component INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER);
    CREATE TABLE qc_inspections (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, result TEXT);
    CREATE TABLE shortage_cases (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT);
    CREATE TABLE ncr_reports (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, closed_at TEXT);
    CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT);
    CREATE TABLE erp_cost_ledger (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, debit_amount REAL, credit_amount REAL);
  `);
  return db;
}

function makeApp() {
  const routes = {};
  for (const method of ["get", "post", "put", "delete"]) {
    routes[method] = (routePath, handler) => {
      routes[method.toUpperCase() + " " + routePath] = handler;
    };
  }
  return routes;
}

async function call(routes, method, routePath, reqPatch = {}) {
  const handler = routes[method.toUpperCase() + " " + routePath];
  if (!handler) throw new Error("no route: " + method + " " + routePath);
  const req = {
    params: {},
    query: {},
    body: {},
    user: { id: 1 },
    ...reqPatch,
  };
  let body = null;
  let error = null;
  const res = {
    json(value) { body = value; return this; },
  };
  await handler(req, res, (err) => { error = err; });
  return { body, error };
}

test("equipment lifecycle endpoint enforces state machine and migrates legacy vocabulary", async () => {
  const db = makeDb();
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, status, lifecycle_stage) VALUES (?, ?, ?, ?, ?)").run(1, "TBM-001", "测试盾构", "designing", "designing");
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);

  assert.equal(db.prepare("SELECT lifecycle_stage FROM equipment_instances WHERE id = 1").get().lifecycle_stage, "design");
  const invalid = await call(app, "post", "/api/equipment_instances/:id/lifecycle", {
    params: { id: 1 },
    body: { lifecycle_stage: "delivered" },
  });
  assert.equal(invalid.error.status, 400);
  assert.match(invalid.error.message, /不允许/);
  assert.equal(db.prepare("SELECT lifecycle_stage FROM equipment_instances WHERE id = 1").get().lifecycle_stage, "design");

  const valid = await call(app, "post", "/api/equipment_instances/:id/lifecycle", {
    params: { id: 1 },
    body: { lifecycle_stage: "procurement", reason: "设计冻结后进入采购" },
  });
  assert.equal(valid.error, null);
  assert.deepEqual(valid.body, { id: 1, from_stage: "design", to_stage: "procurement" });
  assert.equal(db.prepare("SELECT lifecycle_stage FROM equipment_instances WHERE id = 1").get().lifecycle_stage, "procurement");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM equipment_instance_lifecycle_logs WHERE equipment_instance_id = 1").get().c, 1);
});
