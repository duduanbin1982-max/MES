"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const variance = require("../services/cost/variance");
const projectCostEntries = require("../services/cost/projectCostEntries");
const { ensureReadModel } = require("../services/cost/rollup/readModel");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, contract_no TEXT, contract_amount REAL, contract_amount_unit TEXT, status TEXT, progress_pct REAL);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, unit TEXT, estimated_unit_price REAL, actual_unit_price REAL);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER);
    CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, component_type TEXT, supplier TEXT, unit_price REAL, last_price_id INTEGER);
    CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER, actual_price REAL, contract_no TEXT, vendor_po TEXT, currency TEXT, valid_from TEXT, valid_to TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, estimated_hours REAL, actual_hours REAL, status TEXT);
    CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY, work_order_id INTEGER, hours_worked REAL);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, estimated_hours REAL);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, material_id INTEGER);
    CREATE TABLE material_movements (id INTEGER PRIMARY KEY, movement_type TEXT, project_id INTEGER, work_order_id INTEGER, material_lot_id INTEGER, quantity REAL);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO equipment_instances VALUES (1, 'P-1', '项目一', '客户', 'C-1', 5000, 'yuan', 'active', 10);
    INSERT INTO materials VALUES (10, 'K-1', '主轴承', 'mech', 'pcs', 100, NULL), (20, 'M-1', '钢板', 'raw', 'kg', 10, 10);
    INSERT INTO key_components VALUES (1, 10, 'bearing', 'SKF', 0.01, NULL);
    INSERT INTO instance_bom VALUES (1, 1, 10, 1, 1), (2, 1, 20, 2, 0);
    INSERT INTO work_orders VALUES (1, 1, 10, 5, 'completed');
    INSERT INTO work_order_operations VALUES (1, 1, 5);
    INSERT INTO process_nodes VALUES (1, 1, 10);
    INSERT INTO material_lots VALUES (1, 20);
    INSERT INTO material_movements VALUES (1, 'issue', 1, NULL, 1, 2);
    INSERT INTO system_settings VALUES ('labor_rate_per_hour', '200');
  `);
  projectCostEntries.ensureSchema(db);
  db.prepare("INSERT INTO project_cost_entries (equipment_instance_id, cost_type, description, amount, occurred_on, status) VALUES (1,'labor','人工',800,'2026-01-01','posted'),(1,'outsourcing','外协',200,'2026-01-02','posted')").run();
  ensureReadModel(db);
  return db;
}

test("COST-VAR 项目偏差全口径：关键件价差+台账人工/其他+材料代理", async () => {
  const db = makeDb();
  const routes = {};
  const app = { get: (path, ...handlers) => { routes[path] = handlers; }, post() {}, put() {}, delete() {} };
  variance.register(app, db);
  const call = () => new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
    routes["/api/equipment_instances/:id/cost_variance"][0]({ params: { id: "1" }, query: {}, body: {} }, res, (error) => resolve({ error }));
  });
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.key_components.count, 1);
  assert.equal(result.body.key_components.estimated_total, 100);
  assert.equal(result.body.key_components.actual_total, 100);
  assert.equal(result.body.full_totals.key_component_standard, 100);
  assert.equal(result.body.full_totals.labor_actual, 800, "台账人工优先");
  assert.equal(result.body.full_totals.other_costs, 200);
  assert.equal(result.body.full_totals.material_actual, 120, "未领料物料用标准成本占位，不能当节约");
  assert.equal(result.body.full_totals.actual_cost, 1220);
  assert.equal(result.body.full_totals.standard_cost, 2220);
  assert.equal(result.body.full_totals.total_variance, -1000);
  assert.equal(result.body.ledger.actual_total_including_other, 1220);
  db.close();
});
