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
      purchase_date TEXT, warranty_end TEXT, responsible_user_id INTEGER, notes TEXT, updated_at TEXT,
      original_value REAL, depreciation_method TEXT, depreciation_years INTEGER, residual_rate REAL,
      commission_date TEXT, retired_at TEXT, retire_reason TEXT
    );
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, code TEXT, name TEXT, workshop TEXT, station_type TEXT, status TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE iot_devices (id INTEGER PRIMARY KEY, equipment_id INTEGER, production_equipment_id INTEGER, device_code TEXT, status TEXT, last_seen_at TEXT);
    CREATE TABLE equipment_maintenance_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, plan_code TEXT, plan_name TEXT, maintenance_type TEXT, frequency_days INTEGER, next_due_date TEXT, last_done_date TEXT, status TEXT, assigned_to INTEGER, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE equipment_maintenance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, plan_id INTEGER, performed_by INTEGER, performed_at TEXT, hours_spent REAL, findings TEXT, actions_taken TEXT, parts_replaced TEXT, next_due_at TEXT, status TEXT, created_at TEXT);
    CREATE TABLE equipment_oee_shift_log (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, shift_date TEXT, shift_name TEXT, planned_minutes REAL, operating_minutes REAL, ideal_cycle_time REAL, total_output REAL, good_output REAL, source TEXT, notes TEXT, created_at TEXT);
    CREATE TABLE equipment_status_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, from_status TEXT, to_status TEXT, reason TEXT, changed_by INTEGER, changed_at TEXT);
    INSERT INTO workstations VALUES (1,'WS-1','激光切割工位','下料','cutting','available',1);
    INSERT INTO equipment (code,name,equipment_type,workstation_id,status,asset_no,criticality) VALUES ('EQ-1','激光切割机','laser_cutter',1,'idle','A-1','A');
    INSERT INTO iot_devices VALUES (1,NULL,1,'PLC-1','online','2026-11-09 10:00:00');
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

  const status = await call(routes, "POST /api/equipment-ledger/:id/status", { params: { id: String(id) }, body: { status: "maintenance", reason: "故障维修" } });
  assert.equal(status.body.status, "maintenance");
  const statusLogs = await call(routes, "GET /api/equipment-ledger/:id/status-logs", { params: { id: String(id) } });
  assert.ok(statusLogs.body.length >= 2);

  const plan = await call(routes, "POST /api/equipment-ledger/:id/maintenance/plans", { params: { id: String(id) }, body: { plan_name: "月度保养", maintenance_type: "periodic", frequency_days: 30, next_due_date: "2026-12-01" } });
  assert.equal(plan.statusCode, 201);
  const log = await call(routes, "POST /api/equipment-ledger/:id/maintenance/logs", { params: { id: String(id) }, body: { plan_id: plan.body.id, performed_at: "2026-11-10", hours_spent: 2, findings: "正常" } });
  assert.equal(log.statusCode, 201);
  const maintenance = await call(routes, "GET /api/equipment-ledger/:id/maintenance", { params: { id: String(id) } });
  assert.equal(maintenance.body.plans.length, 1);
  assert.equal(maintenance.body.logs.length, 1);

  const oee = await call(routes, "POST /api/equipment-ledger/:id/oee", { params: { id: String(id) }, body: { shift_date: "2026-11-10", shift_name: "白班", planned_minutes: 480, operating_minutes: 400, ideal_cycle_time: 0.5, total_output: 600, good_output: 570 } });
  assert.equal(oee.statusCode, 201);
  const oeeData = await call(routes, "GET /api/equipment-ledger/:id/oee", { params: { id: String(id) } });
  assert.equal(oeeData.body.summary.shifts, 1);
  assert.ok(oeeData.body.summary.oee > 0);

  const removed = await call(routes, "DELETE /api/equipment-ledger/:id", { params: { id: String(id) } });
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.retired, true);
  assert.equal(db.prepare("SELECT status FROM equipment WHERE id = ?").get(id).status, "retired");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM equipment").get().c, 2);
  db.close();
});
