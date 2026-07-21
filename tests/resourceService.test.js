"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const resourceService = require("../services/resourceService");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      full_name TEXT,
      role_code TEXT,
      cert_type TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE workstations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      workshop TEXT,
      capacity_per_day INTEGER,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY,
      instance_code TEXT,
      instance_name TEXT,
      status TEXT,
      lifecycle_stage TEXT,
      progress_pct REAL,
      customer_name TEXT
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY,
      wo_code TEXT,
      title TEXT,
      status TEXT,
      workstation_id INTEGER,
      priority INTEGER
    );
    CREATE TABLE equipment (
      id INTEGER PRIMARY KEY,
      code TEXT,
      name TEXT,
      status TEXT,
      workstation_id INTEGER
    );
    INSERT INTO users (id, full_name, role_code, is_active) VALUES (1, '王师傅', 'worker', 1);
    INSERT INTO workstations (id, code, name, workshop, capacity_per_day, is_active)
      VALUES (1, 'WS-ASM-01', '装配工位 1', '总装', 2, 1);
    INSERT INTO equipment_instances (id, instance_code, instance_name, status)
      VALUES (1, 'TBM-001', '测试盾构', 'assembly');
  `);
  return db;
}

function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put"]) {
    app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  }
  resourceService.register(app, db);
  return { routes, find: (method, route) => routes.get(`${method} ${route}`) };
}

function createResponse() {
  const state = { status: 200, body: null };
  const response = {
    status(code) { state.status = code; return response; },
    json(body) { state.body = body; return response; },
  };
  return { response, state };
}

async function invoke(handler, request = {}) {
  const { response, state } = createResponse();
  let error;
  await handler({ params: {}, query: {}, body: {}, ...request }, response, (caught) => { error = caught; });
  if (error) throw error;
  return state;
}

test("resource service registers bounded route groups and standard workstations", async () => {
  const db = createDatabase();
  const { routes, find } = createApp(db);
  assert.equal(routes.size, 12);

  const types = await invoke(find("GET", "/api/resources/workstation-types"));
  assert.ok(types.body.some((item) => item.value === "inspection"));

  const workstations = await invoke(find("GET", "/api/resources/workstations"));
  assert.ok(workstations.body.workstations.some((item) => item.station_type === "assembly"));
  assert.ok(workstations.body.workstations.some((item) => item.station_type === "inspection"));
  assert.equal(workstations.body.workstations.find((item) => item.id === 1).available_slots, 1);
  db.close();
});

test("resource allocation updates worker availability and allocation history", async () => {
  const db = createDatabase();
  const { find } = createApp(db);
  const result = await invoke(find("POST", "/api/resources/allocations"), {
    body: { user_id: 1, workstation_id: 1, equipment_instance_id: 1, notes: "总装派工" },
  });
  assert.equal(result.body.ok, true);
  assert.equal(db.prepare("SELECT availability FROM users WHERE id = 1").get().availability, "busy");
  assert.equal(db.prepare("SELECT status FROM resource_allocations WHERE id = ?").get(result.body.allocation_id).status, "active");
  db.close();
});
