"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const qcService = require("../services/qcService");

function createHarness() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT);
    CREATE TABLE qc_inspections (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      work_order_id INTEGER,
      inspection_type TEXT,
      result TEXT,
      inspector_id INTEGER,
      notes TEXT,
      inspection_date TEXT DEFAULT (datetime('now'))
    );
  `);
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put"]) {
    app[method] = (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler);
  }
  qcService.register(app, db);
  return { db, routes };
}

test("quality service registers the inspection and NCR closure API", () => {
  const { db, routes } = createHarness();
  assert.equal(routes.size, 22);
  for (const table of ["ncr_reports", "capa_actions", "inspection_templates", "ncr_rechecks"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  db.close();
});

test("legacy incoming inspection endpoint rejects orphan inspection writes", async () => {
  const { db, routes } = createHarness();
  let error;
  await routes.get("POST /api/qc/incoming-inspection")({
    body: { material_id: 12, result: "fail", defect_desc: "尺寸超差", defect_qty: 2, inspector_id: 7 },
  }, { json() {} }, (caught) => { error = caught; });
  assert.match(error.message, /旧来料检验入口已停用/);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM qc_inspections").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM ncr_reports").get().c, 0);
  db.close();
});
