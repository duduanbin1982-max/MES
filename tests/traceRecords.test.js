"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { registerTraceRecordRoutes } = require("../services/trace/records");

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, material_id INTEGER, lot_no TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, wo_code TEXT, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE serial_numbers (id INTEGER PRIMARY KEY AUTOINCREMENT, serial_no TEXT UNIQUE NOT NULL, lot_id INTEGER, equipment_instance_id INTEGER, status TEXT DEFAULT 'in_stock', notes TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE serial_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, serial_id INTEGER, lot_id INTEGER, work_order_id INTEGER, equipment_instance_id INTEGER, movement_type TEXT, quantity REAL DEFAULT 1, moved_by INTEGER, moved_at TEXT DEFAULT (datetime('now')), notes TEXT);
    CREATE TABLE assembly_records (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, step_no INTEGER, step_name TEXT, operator_id INTEGER, assembly_date TEXT DEFAULT (datetime('now')), torque_value_nm REAL, clearance_mm REAL, photos TEXT, notes TEXT);
    CREATE TABLE weld_records (id INTEGER PRIMARY KEY, work_order_id INTEGER, weld_no TEXT);
    CREATE TABLE ndt_records (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, weld_record_id INTEGER, ndt_method TEXT, ndt_grade TEXT, result TEXT, inspector_id INTEGER, report_no TEXT, report_file TEXT, inspection_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO equipment_instances VALUES (1, 'TBM-1', 'Test');
    INSERT INTO materials VALUES (1, 'M1', 'Part');
    INSERT INTO material_lots VALUES (1, 1, 'LOT-1');
    INSERT INTO work_orders VALUES (1, 1, 'WO-1', 'Assembly');
    INSERT INTO work_orders VALUES (2, 2, 'WO-2', 'Other');
    INSERT INTO weld_records VALUES (1, 1, 'W-1');
  `);
  const routes = {};
  const app = {};
  for (const method of ["get", "post"]) app[method] = (path, handler) => { routes[method.toUpperCase() + " " + path] = handler; };
  registerTraceRecordRoutes(app, db);
  return { db, routes };
}

function call(routes, method, path, req) {
  let status = 200; let body;
  const res = { status(code) { status = code; return res; }, json(value) { body = value; return res; } };
  routes[method + " " + path](req, res, (error) => { if (error) { status = error.status || 500; body = { error: error.message }; } });
  return { status, body };
}

test("serial registration creates immutable first movement", () => {
  const { db, routes } = setup();
  const response = call(routes, "POST", "/api/trace/serials", { body: { serial_no: "SN-1", lot_id: 1, equipment_instance_id: 1 }, user: { sub: 7 } });
  assert.equal(response.status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM serial_movements").get().c, 1);
  assert.equal(db.prepare("SELECT movement_type FROM serial_movements").get().movement_type, "register");
});

test("serial movement rejects work order from another equipment", () => {
  const { routes } = setup();
  call(routes, "POST", "/api/trace/serials", { body: { serial_no: "SN-1", lot_id: 1, equipment_instance_id: 1 }, user: {} });
  const response = call(routes, "POST", "/api/trace/serials/:id/movements", { params: { id: 1 }, body: { movement_type: "assemble", work_order_id: 2 }, user: {} });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /不一致/);
});

test("NDT record requires matching weld and work order", () => {
  const { db, routes } = setup();
  const ok = call(routes, "POST", "/api/trace/ndt-records", { body: { work_order_id: 1, weld_record_id: 1, ndt_method: "UT", result: "pass" }, user: { sub: 8 } });
  assert.equal(ok.status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ndt_records").get().c, 1);
  const invalid = call(routes, "POST", "/api/trace/ndt-records", { body: { work_order_id: 2, weld_record_id: 1, ndt_method: "UT", result: "pass" }, user: {} });
  assert.equal(invalid.status, 400);
});
