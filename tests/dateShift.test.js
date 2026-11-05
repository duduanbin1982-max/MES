"use strict";
// 2026-11-05（P3）：多选批量改期 —— 接口测试
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const path = require("node:path");
const svcPath = path.resolve(__dirname, "../services/equipment/scheduler");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, planned_start TEXT, start_date TEXT)`);
  db.exec(`CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, sequence INTEGER DEFAULT 1, estimated_hours REAL DEFAULT 0, required_workstation_id INTEGER, status TEXT DEFAULT 'pending', planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE process_dependencies (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, predecessor_id INTEGER, successor_id INTEGER, dep_type TEXT DEFAULT 'FS', lag_hours INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE process_reschedule_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_no TEXT, shift_days INTEGER, instance_id INTEGER, subsystem_id INTEGER, only_overdue INTEGER, anchor_date TEXT, node_count INTEGER, items_json TEXT, note TEXT, undone_at TEXT, created_by INTEGER, created_at TEXT)`);
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, planned_start) VALUES (1,'T1','一号机','2026-07-01'),(2,'T2','二号机','2026-07-01')").run();
  const ins = db.prepare("INSERT INTO process_nodes (id, equipment_instance_id, operation_name, status, planned_start, planned_end) VALUES (?,?,?,?,?,?)");
  ins.run(101, 1, "下料", "ready", "2026-07-01 08:00:00", "2026-07-01 16:00:00");
  ins.run(102, 1, "焊接", "in_progress", "2026-07-02", "2026-07-04");
  ins.run(103, 1, "总装", "completed", "2026-06-01 00:00:00", "2026-06-02 00:00:00");
  ins.run(104, 1, "未排", "ready", null, null);
  ins.run(201, 2, "别项目", "ready", "2026-07-01", "2026-07-02");
  return db;
}

function makeApp() { const r = {}; for (const m of ["get", "post", "put", "delete"]) r[m] = (p, ...hs) => { r[m.toUpperCase() + " " + p] = hs; }; return r; }

function call(app, method, p, body, query) {
  const hs = app[method.toUpperCase() + " " + p];
  if (!hs) throw new Error("no route: " + method + " " + p);
  const req = { method, query: query || {}, body: body || {}, params: { id: "1" } };
  let s = 200, b = null;
  const res = { status(c) { s = c; return this; }, json(x) { b = x; return this; } };
  for (const h of hs) h(req, res);
  return { status: s, body: b };
}

function fresh() {
  const db = makeDb();
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  return { db, app };
}

test("DS.1 dryRun：预览改期，跳过完成/未排/别的项目，不写库", () => {
  const { db, app } = fresh();
  const r = call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101, 102, 103, 104, 201], shift_days: 7 }, { dryRun: "1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed_count, 2);
  assert.equal(r.body.written_count, 0);
  assert.equal(r.body.skipped.length, 3);
  const reasons = r.body.skipped.map((s) => s.reason).join("|");
  assert.match(reasons, /已完成/);
  assert.match(reasons, /未排程/);
  assert.match(reasons, /不属于该项目/);
  const first = r.body.full.find((c) => c.id === 101);
  assert.equal(first.old_planned_start, "2026-07-01 08:00:00");
  assert.equal(first.new_planned_start, "2026-07-08 08:00:00", "加 7 天且保留时分秒");
  const dateOnly = r.body.full.find((c) => c.id === 102);
  assert.equal(dateOnly.new_planned_start, "2026-07-09", "纯日期保持 10 位格式");
  const dbRow = db.prepare("SELECT planned_start FROM process_nodes WHERE id = 101").get();
  assert.equal(dbRow.planned_start, "2026-07-01 08:00:00", "dryRun 不写库");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM process_reschedule_batches").get().c, 0);
});

test("DS.2 应用：写库 + 批次（可撤销格式）", () => {
  const { db, app } = fresh();
  const r = call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101, 102], shift_days: -3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.written_count, 2);
  assert.match(String(r.body.batch_no), /^MS-\d{8}-\d{3}$/);
  assert.ok(r.body.batch_id);
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 101").get().planned_start, "2026-06-28 08:00:00");
  const batch = db.prepare("SELECT * FROM process_reschedule_batches WHERE id = ?").get(r.body.batch_id);
  assert.equal(batch.node_count, 2);
  assert.match(batch.note, /manual shift -3 days/);
  const items = JSON.parse(batch.items_json);
  const item = items.find((x) => x.id === 101);
  assert.deepEqual(Object.keys(item).sort(), ["id", "operation_name", "new_planned_end", "new_planned_start", "old_planned_end", "old_planned_start", "status"].sort(), "撤销接口依赖的字段齐全");
  assert.equal(item.old_planned_start, "2026-07-01 08:00:00");
  assert.equal(item.new_planned_start, "2026-06-28 08:00:00");
});

test("DS.3 参数校验", () => {
  const { app } = fresh();
  assert.equal(call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [], shift_days: 3 }).status, 400);
  assert.equal(call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101], shift_days: 0 }).status, 400);
  assert.equal(call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101], shift_days: 1.5 }).status, 400);
  assert.equal(call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101], shift_days: 99999 }).status, 400);
  const ok = call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [101, 101], shift_days: 1 }, { dryRun: "1" });
  assert.equal(ok.body.requested_count, 1, "重复 id 自动去重");
});

test("DS.4 全部跳过时 changed_count=0 且不写批次", () => {
  const { db, app } = fresh();
  const r = call(app, "post", "/api/equipment_instances/:id/nodes/date-shift", { node_ids: [103, 104], shift_days: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed_count, 0);
  assert.equal(r.body.written_count, 0);
  assert.equal(r.body.batch_id, null);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM process_reschedule_batches").get().c, 0);
});
