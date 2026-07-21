"use strict";

process.env.JWT_SECRET ||= "test-secret-that-is-long-enough-for-eco-tests";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const ecoService = require("../services/eco");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE instance_eco (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      eco_no TEXT,
      title TEXT,
      reason TEXT,
      affected_scope TEXT,
      effective_date TEXT,
      closed_date TEXT,
      created_by INTEGER,
      status TEXT DEFAULT 'open',
      updated_at TEXT
    );
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      part_number TEXT,
      material_id INTEGER,
      quantity REAL,
      version TEXT,
      category TEXT,
      is_key_component INTEGER,
      unit_price REAL,
      notes TEXT
    );
    CREATE TABLE documents (id INTEGER PRIMARY KEY, eco_id INTEGER, status TEXT, title TEXT, doc_code TEXT);
    CREATE TABLE workflow_instances (id INTEGER PRIMARY KEY, entity_type TEXT, entity_id INTEGER, current_state TEXT);
  `);
  return db;
}

function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put"]) app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  ecoService.register(app, db);
  return { routes, find: (method, route) => routes.get(`${method} ${route}`) };
}

async function invoke(handler, request) {
  const state = { body: null };
  let error;
  await handler({ params: {}, query: {}, body: {}, ...request }, { json: (body) => { state.body = body; } }, (caught) => { error = caught; });
  if (error) throw error;
  return state.body;
}

test("eco service keeps CRUD and impact routes registered after split", async () => {
  const db = createDatabase();
  const { routes, find } = createApp(db);
  assert.equal(routes.size, 5);
  const created = await invoke(find("POST", "/api/equipment_instances/:id/eco"), {
    params: { id: 1 },
    body: { eco_no: "ECO-001", title: "刀盘设计变更", affected_scope: "刀盘" },
  });
  assert.ok(created.id > 0);
  const list = await invoke(find("GET", "/api/equipment_instances/:id/eco"), { params: { id: 1 } });
  assert.equal(list.length, 1);
  const impact = await invoke(find("GET", "/api/instance_eco/:id/impact"), { params: { id: created.id } });
  assert.equal(impact.score, 0);
  assert.equal(impact.summary, "无关联 BOM 节点");
  db.close();
});
