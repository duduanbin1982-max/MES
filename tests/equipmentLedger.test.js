"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { registerSummaryRoutes } = require("../services/resourceService/summaryRoutes");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT, lifecycle_stage TEXT, archive_status TEXT, planned_end TEXT, customer_name TEXT, serial_no TEXT, project_no TEXT, contract_no TEXT, progress_pct REAL, equipment_model_id INTEGER);
    CREATE TABLE equipment_models (id INTEGER PRIMARY KEY, model_code TEXT, model_name TEXT, equipment_type_id INTEGER);
    CREATE TABLE equipment_types (id INTEGER PRIMARY KEY, name_zh TEXT);
    INSERT INTO equipment_instances VALUES
      (1,'EQ-1','逾期项目','design','S1','active','2020-01-01','客户A','SN-1','PRJ-1','C-1',10,NULL),
      (2,'EQ-2','归档项目','archived','archived','archived','2025-01-01','客户B',NULL,NULL,NULL,100,NULL),
      (3,'EQ-3','交付项目','delivered','delivered','active','2026-01-01','客户C',NULL,NULL,NULL,100,NULL),
      (4,'EQ-4','制造项目','manufacturing','manufacturing','active','2027-01-01','客户D',NULL,NULL,NULL,50,NULL);
  `);
  return db;
}

test("LEDGER.1 设备台账：S1 归一、归档计入完成、逾期统计、筛选", async () => {
  const db = makeDb();
  const routes = {};
  const app = { get: (path, ...handlers) => { routes[path] = handlers; } };
  const { all, get } = { all: (sql, ...p) => db.prepare(sql).all(...p), get: (sql, ...p) => db.prepare(sql).get(...p) };
  registerSummaryRoutes(app, { all, get });
  const handler = routes["/api/resources/equipment"][0];
  const call = (query = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
    handler({ query, params: {}, body: {} }, res, () => {});
  });
  const allRows = await call();
  assert.equal(allRows.statusCode, 200);
  assert.equal(allRows.body.summary.total, 4);
  assert.equal(allRows.body.summary.active, 3);
  assert.equal(allRows.body.summary.archived, 1);
  assert.equal(allRows.body.summary.completed, 2, "归档和交付都计入完成");
  assert.equal(allRows.body.summary.in_progress, 2);
  assert.equal(allRows.body.summary.delayed, 1, "计划完成已过且未完成算延期");
  const s1 = allRows.body.equipment.find((row) => row.instance_code === "EQ-1");
  assert.equal(s1.lifecycle_stage_normalized, "design", "S1 归一为 design");
  assert.equal(s1.is_overdue, 1);

  const filtered = await call({ keyword: "归档" });
  assert.equal(filtered.body.equipment.length, 1);
  assert.equal(filtered.body.summary.total, 1);
  const excluded = await call({ include_archived: "false" });
  assert.equal(excluded.body.equipment.length, 3);
  assert.equal(excluded.body.summary.archived, 0);
  const stage = await call({ stage: "manufacturing" });
  assert.equal(stage.body.equipment.length, 1);
  db.close();
});
