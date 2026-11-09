"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const reportService = require("../services/reportService/reportService");
const projectCostEntries = require("../services/cost/projectCostEntries");
const { ensureReadModel } = require("../services/cost/rollup/readModel");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, contract_no TEXT, contract_amount REAL, contract_amount_unit TEXT, status TEXT, progress_pct REAL);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, spec TEXT, unit TEXT, estimated_unit_price REAL, actual_unit_price REAL);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER);
    CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, component_type TEXT, supplier TEXT, unit_price REAL);
    CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER, actual_price REAL, contract_no TEXT, vendor_po TEXT, currency TEXT, valid_from TEXT, valid_to TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, estimated_hours REAL, actual_hours REAL, status TEXT);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO equipment_instances VALUES (1,'TBM-REAL','真实项目','客户','C-1',1800,'wan','active',10),(2,'TBM-DEMO-001','培训演练机','客户','D-1',1000000,'wan','active',0);
    INSERT INTO materials VALUES (10,'K-1','关键件','mech','x','pcs',0.01,0.01),(20,'M-1','钢板','raw','x','kg',10,5);
    INSERT INTO instance_bom VALUES (1,1,10,2,1),(2,1,20,3,0),(3,2,20,1,0);
    INSERT INTO key_components VALUES (1,10,'bearing','SKF',0.01);
    INSERT INTO key_component_prices (key_component_id,actual_price,currency,valid_from,valid_to) VALUES (1,0.02,'CNY','2020-01-01',NULL);
    INSERT INTO work_orders VALUES (1,1,10,10,'completed'),(2,2,1,1,'completed');
    INSERT INTO system_settings VALUES ('labor_rate_per_hour','200');
  `);
  projectCostEntries.ensureSchema(db);
  db.prepare("INSERT INTO project_cost_entries (equipment_instance_id,cost_type,description,amount,occurred_on,status) VALUES (1,'labor','人工',1000,'2026-01-01','posted')").run();
  ensureReadModel(db);
  return db;
}

test("BIZ-COST 成本汇总：全口径、合同单位归一、默认排除演练机", async () => {
  const db = makeDb();
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes[path] = handlers; },
    post: (path, ...handlers) => { routes["POST " + path] = handlers; },
    put() {}, delete() {}, patch() {},
  };
  reportService.register(app, db);
  const handler = routes["POST /api/reports/generate"][0];
  const call = (body) => new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; resolve(this); } };
    handler({ body, query: {}, params: {} }, res, (error) => resolve({ error }));
  });
  const all = await call({ type: "cost_summary", filters: {} });
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.rows.length, 1, "默认排除演练机");
  assert.equal(all.body.rows[0].instance_code, "TBM-REAL");
  assert.equal(all.body.rows[0].contract_yuan, 18000000);
  assert.equal(all.body.rows[0].key_component_cost, 400);
  assert.equal(all.body.rows[0].material_cost, 15);
  assert.equal(all.body.rows[0].labor_cost, 1000);
  assert.equal(all.body.rows[0].total_cost, 1415);
  assert.equal(all.body.rows[0].gross_margin, 17998585);
  assert.equal(all.body.summary.total_projects, 1);
  assert.equal(all.body.summary.total_contract, 18000000);
  assert.equal(all.body.summary.total_actual_cost, 1415);
  db.close();
});
