"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const projectCostEntries = require("../services/cost/projectCostEntries");
const { registerPeriodRoutes } = require("../services/cost/periodRoutes");

function makeApp() {
  const routes = [];
  const push = (method) => (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
  return { routes, get: push("GET"), put: push("PUT"), post: push("POST"), delete: push("DELETE") };
}
function callRoute(app, method, routePath, req = {}) {
  const route = app.routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `route not registered: ${method} ${routePath}`);
  return new Promise((resolve) => {
    const fullReq = { query: {}, body: {}, params: {}, user: { role: "admin", uid: 1 }, ...req };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve({ res: this }); return this; },
    };
    let index = 0;
    const next = (err) => {
      if (err) return resolve({ err });
      const handler = route.handlers[index++];
      if (!handler) return resolve({ err: new Error("no handler") });
      try {
        const out = handler(fullReq, res, next);
        if (out && typeof out.then === "function") out.catch(next);
      } catch (error) { next(error); }
    };
    next();
  });
}
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, wo_code TEXT);
    INSERT INTO equipment_instances VALUES (1, 'P-1', '项目一'), (2, 'P-2', '项目二');
    INSERT INTO instance_bom VALUES (10, 1, 1, 1), (11, 2, 1, 1);
    INSERT INTO work_orders VALUES (20, 1, 'WO-1'), (21, 2, 'WO-2');
  `);
  projectCostEntries.ensureSchema(db);
  return db;
}

test("COST-E1 成本台账：非法日期/跨项目 BOM 引用被拒，合法新增可汇总/作废", async () => {
  const db = makeDb();
  const app = makeApp();
  projectCostEntries.register(app, db);

  const badDate = await callRoute(app, "POST", "/api/project_cost_entries", {
    body: { equipment_instance_id: 1, cost_type: "material", description: "钢板", amount: 100, occurred_on: "2026-02-31" },
  });
  assert.equal(badDate.res.statusCode, 400);

  const crossBom = await callRoute(app, "POST", "/api/project_cost_entries", {
    body: { equipment_instance_id: 1, bom_node_id: 11, cost_type: "material", description: "钢板", amount: 100, occurred_on: "2026-02-01" },
  });
  assert.equal(crossBom.res.statusCode, 400);

  const created = await callRoute(app, "POST", "/api/project_cost_entries", {
    body: { equipment_instance_id: 1, bom_node_id: 10, cost_type: "outsourcing", description: "外协加工", amount: 123.456, occurred_on: "2026-02-01" },
  });
  assert.equal(created.res.body.ok, true);
  assert.equal(created.res.body.item.amount, 123.46);
  assert.equal(created.res.body.item.currency, "CNY");

  const list = await callRoute(app, "GET", "/api/project_cost_entries", { query: { equipment_instance_id: "1", limit: "1" } });
  assert.equal(list.res.body.items.length, 1);
  assert.equal(list.res.body.total, 1);
  const summary = await callRoute(app, "GET", "/api/project_cost_entries/summary", { query: { equipment_instance_id: "1" } });
  assert.equal(summary.res.body.by_type.outsourcing.amount, 123.46);
  assert.equal(summary.res.body.total, 123.46);

  const voided = await callRoute(app, "DELETE", "/api/project_cost_entries/:id", { params: { id: String(created.res.body.item.id) } });
  assert.equal(voided.res.body.ok, true);
  const after = await callRoute(app, "GET", "/api/project_cost_entries", { query: { equipment_instance_id: "1" } });
  assert.equal(after.res.body.count, 0);
  db.close();
});

test("COST-E2 回填费率非法被拒", async () => {
  const db = makeDb();
  const app = makeApp();
  projectCostEntries.register(app, db);
  const bad = await callRoute(app, "POST", "/api/project_cost_entries/backfill", { body: { hourly_rate: 0 } });
  assert.equal(bad.res.statusCode, 400);
  const negative = await callRoute(app, "POST", "/api/project_cost_entries/backfill", { body: { hourly_rate: -1 } });
  assert.equal(negative.res.statusCode, 400);
  db.close();
});


test("COST-E3 期间锁定/反关账 + 多币种折算", async () => {
  const db = makeDb();
  const app = makeApp();
  projectCostEntries.register(app, db);
  registerPeriodRoutes(app, db);
  const locked = await callRoute(app, "POST", "/api/cost_periods/:period/lock", { params: { period: "2026-02" } });
  assert.equal(locked.res.body.status, "locked");
  const blocked = await callRoute(app, "POST", "/api/project_cost_entries", {
    body: { equipment_instance_id: 1, cost_type: "material", description: "锁定期间", amount: 100, occurred_on: "2026-02-10" },
  });
  assert.equal(blocked.res.statusCode, 409);
  const reopened = await callRoute(app, "POST", "/api/cost_periods/:period/reopen", { params: { period: "2026-02" } });
  assert.equal(reopened.res.body.status, "open");

  db.prepare("INSERT INTO cost_fx_rates (currency, rate_to_cny) VALUES ('USD', 7.2)").run();
  const usd = await callRoute(app, "POST", "/api/project_cost_entries", {
    body: { equipment_instance_id: 1, cost_type: "outsourcing", description: "美元外协", amount: 100, currency: "USD", occurred_on: "2026-03-01" },
  });
  assert.equal(usd.res.statusCode, 200);
  const list = await callRoute(app, "GET", "/api/project_cost_entries", { query: { equipment_instance_id: "1" } });
  assert.equal(list.res.body.items[0].amount_cny, 720);
  const summary = await callRoute(app, "GET", "/api/project_cost_entries/summary", { query: { equipment_instance_id: "1" } });
  assert.equal(summary.res.body.total, 720);
  db.close();
});
