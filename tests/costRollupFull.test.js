"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const rollup = require("../services/cost/rollup");
const { ensureReadModel } = require("../services/cost/rollup/readModel");
const projectCostEntries = require("../services/cost/projectCostEntries");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, contract_no TEXT, contract_amount REAL, contract_amount_unit TEXT, status TEXT, progress_pct REAL);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, unit TEXT, estimated_unit_price REAL);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER);
    CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, component_type TEXT, supplier TEXT, unit_price REAL, last_price_id INTEGER);
    CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER, actual_price REAL, contract_no TEXT, vendor_po TEXT, currency TEXT, valid_from TEXT, valid_to TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, estimated_hours REAL, actual_hours REAL, status TEXT);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO equipment_instances VALUES (1, 'P-1', '项目一', '客户', 'C-1', 5000, 'yuan', 'active', 10);
    INSERT INTO materials VALUES (10, 'K-1', '主轴承', 'mech', 'pcs', 100), (20, 'M-1', '钢板', 'raw', 'kg', 10);
    INSERT INTO key_components VALUES (1, 10, 'bearing', 'SKF', 100, NULL);
    INSERT INTO instance_bom VALUES (1, 1, 10, 1, 1), (2, 1, 20, 2, 0);
    INSERT INTO work_orders VALUES (1, 1, 10, 5, 'completed');
    INSERT INTO system_settings VALUES ('labor_rate_per_hour', '200');
  `);
  projectCostEntries.ensureSchema(db);
  db.prepare("INSERT INTO project_cost_entries (equipment_instance_id, cost_type, description, amount, occurred_on, status) VALUES (1,'labor','人工',800,'2026-01-01','posted'),(1,'outsourcing','外协',200,'2026-01-02','posted')").run();
  ensureReadModel(db);
  return db;
}
function call(app, path) {
  const route = app.routes.find((r) => r.method === "GET" && r.path === path);
  return new Promise((resolve) => {
    const req = { params: { id: "1" }, query: {} };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
    route.handlers[0](req, res, (error) => resolve({ error }));
  });
}

test("COST-ROLLUP 全口径：人工按台账、外协单列、合同毛利按全成本", async () => {
  const db = makeDb();
  const app = { routes: [], get(path, handler) { this.routes.push({ method: "GET", path, handlers: [handler] }); } };
  rollup.register(app, db);
  const result = await call(app, "/api/equipment_instances/:id/cost_rollup");
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.totals.estimated_cost, 120);
  assert.equal(result.body.totals.actual_cost, 120);
  assert.equal(result.body.labor.estimated_hours, 10);
  assert.equal(result.body.labor.actual_hours, 5);
  assert.equal(result.body.labor.hourly_rate, 200);
  assert.equal(result.body.labor.estimated_cost, 2000);
  assert.equal(result.body.labor.actual_cost, 800);
  assert.equal(result.body.labor.cost_source, "project_cost_entries");
  assert.equal(result.body.ledger.total, 1000);
  assert.equal(result.body.ledger.other_costs, 200);
  assert.equal(result.body.totals.estimated_cost_full, 2120);
  assert.equal(result.body.totals.actual_cost_full, 1120);
  assert.equal(result.body.totals.cost_diff_full, -1000);
  assert.equal(result.body.contract_margin_full, 3880);
  db.close();
});
