"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Database = require("better-sqlite3");
const express = require("express");
const { errorHandler, notFoundHandler } = require("../app/errors");
const { createDeliveryDbContext } = require("../services/delivery/dbContext");
const { createReadModel } = require("../services/delivery/readModel");
const { migrateLegacyMilestones } = require("../services/equipment/schema");
const { buildSetupStatus } = require("../services/setupWizardService");

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("setup status accepts every governed table", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, role_code TEXT);
    INSERT INTO users VALUES (1, 1);
    INSERT INTO roles VALUES (1, 'admin');
  `);
  const status = buildSetupStatus(db);
  assert.equal(status.steps[0].metrics.roles, 1);
  db.close();
});

test("workflow definitions is not swallowed by dynamic id route", async () => {
  const db = new Database(":memory:");
  const app = express();
  app.use(express.json());
  require("../services/workflowService").register(app, db, {});
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const response = await request(server, "/api/workflow/definitions");
  assert.equal(response.status, 200);
  assert.ok(response.body.some((item) => item.name === "work_order"));
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test("delivery uses project cost entries and canonical acceptance table", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT, lifecycle_stage TEXT, progress_pct REAL, customer_name TEXT, planned_end TEXT, contract_amount REAL, contract_amount_unit TEXT, contract_no TEXT, project_no TEXT, serial_no TEXT);
    CREATE TABLE project_cost_entries (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, cost_type TEXT, source_type TEXT, amount REAL, status TEXT, deleted_at TEXT);
    CREATE TABLE erp_cost_ledger (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, gl_account_code TEXT, source_type TEXT, debit_amount REAL, credit_amount REAL);
    CREATE TABLE acceptance_checklists (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT, result TEXT);
    INSERT INTO equipment_instances VALUES (1, 'TBM-1', 'Test', 'manufacturing', 'manufacturing', 50, 'Customer', NULL, 100000, 'CNY', 'C-1', 'P-1', 'SN-1');
    INSERT INTO project_cost_entries VALUES (1, 1, 'labor', 'work_report', 24500, 'posted', NULL);
    INSERT INTO erp_cost_ledger VALUES (1, 1, '5001', 'manual', 62.5, 0);
    INSERT INTO acceptance_checklists VALUES (1, 1, 'completed', 'pass');
  `);
  const context = createDeliveryDbContext(db);
  const model = createReadModel({ db, ...context, enrichEscalation: (item) => item });
  const instance = model.getInstances()[0];
  const project = model.buildProject(instance, []);
  assert.equal(project.metrics.cost.actual_amount, 24500);
  assert.equal(project.metrics.cost.total, 1);
  assert.equal(project.metrics.acceptance.done, 1);
  db.close();
});

test("legacy equipment milestones migrate into canonical instance milestones", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instance_milestones (id INTEGER PRIMARY KEY, project_id INTEGER, phase_code TEXT, phase_name TEXT, sequence INTEGER, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT, notes TEXT);
    INSERT INTO equipment_instance_milestones VALUES (1, 7, 'S1', '设计冻结', 1, '2026-01-01', NULL, NULL, NULL, 'completed', 'legacy');
  `);
  migrateLegacyMilestones(db);
  migrateLegacyMilestones(db);
  const rows = db.prepare("SELECT * FROM instance_milestones WHERE equipment_instance_id = 7").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phase_code, "S1");
  db.close();
});
