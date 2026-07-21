"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const processHoursService = require("../services/processHoursService");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      full_name TEXT
    );
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY,
      instance_code TEXT,
      instance_name TEXT,
      status TEXT
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY,
      wo_code TEXT,
      title TEXT,
      status TEXT,
      equipment_instance_id INTEGER,
      actual_hours REAL,
      updated_at TEXT
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      operation_name TEXT
    );
    INSERT INTO users (id, username, full_name) VALUES (1, 'worker1', '张师傅');
    INSERT INTO equipment_instances (id, instance_code, instance_name, status)
      VALUES (1, 'TBM-001', '测试盾构', 'assembly');
    INSERT INTO work_orders (id, wo_code, title, status, equipment_instance_id)
      VALUES (1, 'WO-001', '刀盘装配', 'in_progress', 1);
    INSERT INTO process_nodes (id, equipment_instance_id, operation_name)
      VALUES (1, 1, '刀盘装配');
  `);
  return db;
}

function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) {
    app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  }
  processHoursService.register(app, db, null);
  return (method, route) => routes.get(`${method} ${route}`);
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
  assert.equal(typeof handler, "function");
  const { response, state } = createResponse();
  let error;
  await handler({ params: {}, query: {}, body: {}, ...request }, response, (caught) => { error = caught; });
  if (error) throw error;
  return state;
}

test("process hours analytics routes preserve performance, overtime, and daily summaries", async () => {
  const db = createDatabase();
  const find = createApp(db);
  db.prepare(`
    INSERT INTO work_report_details (
      work_order_id, process_node_id, worker_id, hours_spent,
      quantity_completed, quality_result, reported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(1, 1, 1, 9.5, 4, "pass", "2026-07-20 18:30:00");

  const performance = await invoke(find("GET", "/api/process-hours/worker-performance"), {
    query: { from: "2026-07-20", to: "2026-07-20" },
  });
  assert.equal(performance.body.count, 1);
  assert.equal(performance.body.workers[0].full_name, "张师傅");
  assert.equal(performance.body.workers[0].total_hours, 9.5);

  const overtime = await invoke(find("GET", "/api/process-hours/overtime"), {
    query: { from: "2026-07-20", to: "2026-07-20" },
  });
  assert.equal(overtime.body.overtime_days, 1);
  assert.equal(overtime.body.total_overtime_hours, 1.5);

  const daily = await invoke(find("GET", "/api/process-hours/daily-summary"), {
    query: { date: "2026-07-20" },
  });
  assert.deepEqual(daily.body.summary, {
    total_workers: 1,
    total_hours: 9.5,
    total_quantity: 4,
    total_reports: 1,
    active_work_orders: 1,
    active_instances: 1,
  });
  assert.equal(daily.body.work_orders[0].code, "WO-001");
  db.close();
});
