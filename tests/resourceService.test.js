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

test("RS-1 工位容量统计包含 online 人员，且移动本人不占容量", async () => {
  const db = createDatabase();
  db.prepare("INSERT INTO users (id, full_name, role_code, is_active) VALUES (2,'李四','worker',1),(3,'王五','worker',1)").run();
  const { find } = createApp(db);
  db.prepare("UPDATE workstations SET max_workers = 2 WHERE id = 1").run();
  db.prepare("UPDATE users SET workstation_id = 1, availability = 'online' WHERE id IN (1,2)").run();

  const selfMove = await invoke(find("PUT", "/api/resources/workers/:id/station"), {
    params: { id: "1" }, body: { workstation_id: 1, availability: "online" },
  });
  assert.equal(selfMove.body.ok, true);

  await assert.rejects(
    () => invoke(find("PUT", "/api/resources/workers/:id/station"), { params: { id: "3" }, body: { workstation_id: 1 } }),
    (error) => error.status === 400 && /容量已满/.test(error.message),
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/resources/allocations"), { body: { user_id: 3, workstation_id: 1 } }),
    (error) => error.status === 400 && /容量已满/.test(error.message),
  );
  db.close();
});

test("RS-2 工位状态/容量/编码校验与停用人员保护", async () => {
  const db = createDatabase();
  const { find } = createApp(db);
  const post = (body) => invoke(find("POST", "/api/resources/workstations"), { body });
  await assert.rejects(() => post({ code: "WS-X", name: "X", station_type: "bad" }), (error) => error.status === 400);
  await assert.rejects(() => post({ code: "ws-asm-01", name: "重复" }), (error) => error.status === 400 && /已存在/.test(error.message));
  await assert.rejects(() => post({ code: "WS-Y", name: "Y", status: "bad" }), (error) => error.status === 400);
  await assert.rejects(() => post({ code: "WS-Z", name: "Z", max_workers: -1 }), (error) => error.status === 400);

  const created = await post({ code: "WS-NEW", name: "新工位", station_type: "assembly", capacity_per_day: 4, max_workers: 2 });
  assert.equal(created.status, 201);
  await assert.rejects(
    () => invoke(find("PUT", "/api/resources/workstations/:id"), { params: { id: "1" }, body: { status: "bad" } }),
    (error) => error.status === 400,
  );
  db.prepare("UPDATE users SET workstation_id = 1, availability = 'online' WHERE id = 1").run();
  await assert.rejects(
    () => invoke(find("PUT", "/api/resources/workstations/:id"), { params: { id: "1" }, body: { is_active: false } }),
    (error) => error.status === 400 && /不能停用/.test(error.message),
  );
  db.close();
});

test("RS-3 资源概览占用数包含 online 人员", async () => {
  const db = createDatabase();
  const { find } = createApp(db);
  db.prepare("UPDATE users SET workstation_id = 1, availability = 'online' WHERE id = 1").run();
  const overview = await invoke(find("GET", "/api/resources/overview"));
  assert.equal(overview.body.workstations.occupied, 1);
  db.close();
});

test("RS-4 停用工位不可分配人员/资源", async () => {
  const db = createDatabase();
  const { find } = createApp(db);
  db.prepare("UPDATE workstations SET status = 'disabled' WHERE id = 1").run();
  await assert.rejects(
    () => invoke(find("PUT", "/api/resources/workers/:id/station"), { params: { id: "1" }, body: { workstation_id: 1 } }),
    (error) => error.status === 400 && /已停用/.test(error.message),
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/resources/allocations"), { body: { user_id: 1, workstation_id: 1 } }),
    (error) => error.status === 400 && /已停用/.test(error.message),
  );
  db.close();
});
