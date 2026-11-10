"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { register } = require("../services/fieldService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE equipment (id INTEGER PRIMARY KEY, code TEXT, name TEXT, status TEXT, workstation_id INTEGER, last_maintenance TEXT, updated_at TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, workshop TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    INSERT INTO equipment_instances VALUES (1, 'INST-1', '项目装备一');
    INSERT INTO equipment VALUES (1, 'EQ-1', '激光切割机', 'idle', 1, NULL, NULL);
    INSERT INTO workstations VALUES (1, '激光切割工位', '下料');
    INSERT INTO users VALUES (1, '管理员');
    CREATE TABLE equipment_maintenance_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, plan_code TEXT, plan_name TEXT, maintenance_type TEXT, frequency_days INTEGER, next_due_date TEXT, last_done_date TEXT, status TEXT, assigned_to INTEGER, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE equipment_maintenance_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, plan_id INTEGER, performed_by INTEGER, performed_at TEXT, hours_spent REAL, findings TEXT, actions_taken TEXT, parts_replaced TEXT, next_due_at TEXT, status TEXT, created_at TEXT);
    CREATE TABLE equipment_checklists (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, checklist_name TEXT, check_type TEXT, items_json TEXT, assigned_to INTEGER, status TEXT, last_executed_at TEXT, created_at TEXT);
    CREATE TABLE equipment_breakdowns (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, report_code TEXT, fault_type TEXT, fault_desc TEXT, severity TEXT, reported_by INTEGER, reported_at TEXT, status TEXT, assigned_to INTEGER, repair_start TEXT, repair_end TEXT, downtime_hours REAL, root_cause TEXT, repair_actions TEXT, parts_used TEXT, repair_cost REAL, verified_by INTEGER, verified_at TEXT, created_at TEXT);
    CREATE TABLE equipment_spare_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER, part_code TEXT, part_name TEXT, part_type TEXT, quantity INTEGER, min_stock INTEGER, unit TEXT, location TEXT, supplier TEXT, unit_price REAL, notes TEXT, created_at TEXT, updated_at TEXT);
  `);
  return db;
}

function makeApp(db) {
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes["GET " + path] = handlers; },
    post: (path, ...handlers) => { routes["POST " + path] = handlers; },
    put: (path, ...handlers) => { routes["PUT " + path] = handlers; },
  };
  register(app, db);
  return routes;
}

function call(routes, key, req = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
    try { routes[key][0]({ body: {}, params: {}, query: {}, ...req }, res, (error) => resolve({ error })); }
    catch (error) { resolve({ error }); }
  });
}

test("TPM.1 车间设备维保计划/执行/筛选/点检/故障", async () => {
  const db = makeDb();
  const routes = makeApp(db);
  const created = await call(routes, "POST /api/field-service/maintenance-plans", { body: { equipment_id: 1, plan_name: "激光切割机月检", maintenance_type: "monthly", frequency_days: 30, next_due_date: "2026-07-01" } });
  assert.equal(created.statusCode, 200);
  const planId = created.body.id;
  const list = await call(routes, "GET /api/field-service/maintenance-plans");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].plan_name, "激光切割机月检");
  assert.equal(list.body[0].equipment_code, "EQ-1");

  await call(routes, "POST /api/field-service/maintenance-logs", { body: { plan_id: planId, equipment_id: 1, performed_by: 1, hours_spent: 2, findings: "正常", status: "completed" } });
  const logs = await call(routes, "GET /api/field-service/maintenance-logs", { query: { start_date: "2026-01-01", end_date: "2026-12-31", status: "completed" } });
  assert.equal(logs.body.length, 1);
  assert.equal(logs.body[0].plan_name, "激光切割机月检");
  assert.equal(logs.body[0].performer_name, "管理员");

  const completed = await call(routes, "POST /api/field-service/maintenance-plans/:id/complete", { params: { id: String(planId) } });
  assert.equal(completed.body.ok, true);
  assert.ok(completed.body.next_due_date);

  const checklist = await call(routes, "POST /api/field-service/checklists", { body: { equipment_id: 1, checklist_name: "日点检", check_type: "daily" } });
  assert.equal(checklist.statusCode, 200);
  const checklistList = await call(routes, "GET /api/field-service/checklists");
  assert.equal(checklistList.body.length, 1);
  assert.equal(checklistList.body[0].equipment_code, "EQ-1");
  const executed = await call(routes, "PUT /api/field-service/checklists/:id/execute", { params: { id: String(checklist.body.id) }, body: { equipment_id: 1, checklist_name: "日点检", performed_by: 1, results: [{ name: "外观", result: "pass" }], all_pass: true } });
  assert.equal(executed.body.log_type, "checklist");

  const breakdown = await call(routes, "POST /api/field-service/breakdowns", { body: { equipment_id: 1, fault_type: "mechanical", fault_desc: "异响", severity: "high", reported_by: 1 } });
  assert.equal(breakdown.statusCode, 200);
  assert.ok(breakdown.body.report_code);
  db.close();
});
