"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { registerLedgerRoutes } = require("../services/equipment/ledgerRoutes");
const { ApiError } = require("../app/errors");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      equipment_type TEXT, workstation_id INTEGER, status TEXT, last_maintenance TEXT, created_at TEXT,
      asset_no TEXT, manufacturer TEXT, model TEXT, serial_no TEXT, location TEXT, criticality TEXT,
      purchase_date TEXT, warranty_end TEXT, responsible_user_id INTEGER, notes TEXT, updated_at TEXT
    );
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, code TEXT, name TEXT, workshop TEXT, station_type TEXT, status TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE iot_devices (id INTEGER PRIMARY KEY, equipment_id INTEGER, device_code TEXT, status TEXT, last_seen_at TEXT);
    INSERT INTO workstations VALUES (1,'WS-1','激光切割工位','下料','cutting','available',1);
    INSERT INTO equipment (code,name,equipment_type,workstation_id,status,asset_no,criticality) VALUES ('EQ-1','激光切割机','laser_cutter',1,'idle','A-1','A');
    INSERT INTO iot_devices VALUES (1,1,'PLC-1','online','2026-11-09 10:00:00');
  `);
  return db;
}

function makeApp(db) {
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes["GET " + path] = handlers; },
    post: (path, ...handlers) => { routes["POST " + path] = handlers; },
    put: (path, ...handlers) => { routes["PUT " + path] = handlers; },
    delete: (path, ...handlers) => { routes["DELETE " + path] = handlers; },
  };
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  registerLedgerRoutes({ app, wrap: (fn) => fn, all, get, run, ApiError });
  return routes;
}

function call(routes, key, req = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
    try { routes[key][0]({ body: {}, params: {}, query: {}, ...req }, res, (error) => resolve({ error })); }
    catch (error) { resolve({ error }); }
  });
}

test("LEDGER-CRUD 车间设备：列表/汇总/新增/编辑/状态/删除", async () => {
  const db = makeDb();
  const routes = makeApp(db);
  const list = await call(routes, "GET /api/equipment-ledger");
  assert.equal(list.body.equipment.length, 1);
  assert.equal(list.body.equipment[0].iot_online, 1);
  assert.equal(list.body.equipment[0].workshop, "下料");
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.iot_online, 1);

  const created = await call(routes, "POST /api/equipment-ledger", { body: { code: "EQ-2", name: "折弯机", equipment_type: "press_brake", status: "running", asset_no: "A-2", criticality: "B" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.code, "EQ-2");
  const id = created.body.id;

  const updated = await call(routes, "PUT /api/equipment-ledger/:id", { params: { id: String(id) }, body: { name: "1000 吨折弯机", model: "PB-1000" } });
  assert.equal(updated.body.name, "1000 吨折弯机");
  assert.equal(updated.body.model, "PB-1000");

  const status = await call(routes, "POST /api/equipment-ledger/:id/status", { params: { id: String(id) }, body: { status: "maintenance" } });
  assert.equal(status.body.status, "maintenance");

  const removed = await call(routes, "DELETE /api/equipment-ledger/:id", { params: { id: String(id) } });
  assert.equal(removed.body.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM equipment").get().c, 1);
  db.close();
});
