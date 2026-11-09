"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { register } = require("../services/fieldService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    INSERT INTO equipment_instances VALUES (1, 'EQ-1', '项目装备一');
    INSERT INTO users VALUES (1, '管理员');
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

test("TPM.1 维保计划字段/执行/筛选/点检/故障", async () => {
  const db = makeDb();
  const routes = makeApp(db);
  const created = await call(routes, "POST /api/field-service/maintenance-plans", { body: { equipment_instance_id: 1, plan_name: "刀盘月检", maintenance_type: "monthly", frequency_days: 30, next_due_date: "2026-07-01" } });
  assert.equal(created.statusCode, 200);
  const planId = created.body.id;
  const list = await call(routes, "GET /api/field-service/maintenance-plans");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].plan_name, "刀盘月检");
  assert.equal(list.body[0].instance_code, "EQ-1");

  await call(routes, "POST /api/field-service/maintenance-logs", { body: { plan_id: planId, equipment_instance_id: 1, performed_by: 1, hours_spent: 2, findings: "正常", status: "completed" } });
  const logs = await call(routes, "GET /api/field-service/maintenance-logs", { query: { start_date: "2026-01-01", end_date: "2026-12-31", status: "completed" } });
  assert.equal(logs.body.length, 1);
  assert.equal(logs.body[0].plan_name, "刀盘月检");
  assert.equal(logs.body[0].performer_name, "管理员");

  const completed = await call(routes, "POST /api/field-service/maintenance-plans/:id/complete", { params: { id: String(planId) } });
  assert.equal(completed.body.ok, true);
  assert.ok(completed.body.next_due_date);

  const checklist = await call(routes, "POST /api/field-service/checklists", { body: { equipment_instance_id: 1, checklist_name: "日点检", check_type: "daily" } });
  assert.equal(checklist.statusCode, 200);
  const checklistList = await call(routes, "GET /api/field-service/checklists");
  assert.equal(checklistList.body.length, 1);
  const executed = await call(routes, "PUT /api/field-service/checklists/:id/execute", { params: { id: String(checklist.body.id) }, body: { equipment_instance_id: 1, checklist_name: "日点检", performed_by: 1, results: [{ name: "外观", result: "pass" }], all_pass: true } });
  assert.equal(executed.body.log_type, "checklist");

  const breakdown = await call(routes, "POST /api/field-service/breakdowns", { body: { equipment_instance_id: 1, fault_type: "mechanical", fault_desc: "异响", severity: "high", reported_by: 1 } });
  assert.equal(breakdown.statusCode, 200);
  assert.ok(breakdown.body.report_code);
  db.close();
});
