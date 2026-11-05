"use strict";
// tests/scheduleGantt.test.js
// 2026-11-04：甘特图数据接口 + 拖拽改期接口
// 覆盖：区间过滤、实例过滤、未排程列表、非法区间；改期校验（顺序/格式/已完成/不存在）与成功更新。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { makeDbHelpers } = require("../services/schedule/_helpers");
const registerGanttRoutes = require("../services/schedule/routes/routes_gantt");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      operation_name TEXT,
      sequence INTEGER,
      status TEXT,
      phase_code TEXT,
      planned_start TEXT,
      planned_end TEXT,
      estimated_hours REAL,
      subsystem_id INTEGER,
      assigned_to INTEGER,
      required_workstation_id INTEGER,
      updated_at TEXT
    );
    INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机');
    INSERT INTO users (id, full_name) VALUES (7, '张三');
    INSERT INTO workstations (id, name) VALUES (3, '装配工位A');
    CREATE TABLE process_dependencies (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      predecessor_id INTEGER,
      successor_id INTEGER,
      dep_type TEXT,
      lag_hours REAL,
      created_at TEXT
    );
    CREATE TABLE process_reschedule_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, batch_no TEXT, shift_days INTEGER, instance_id INTEGER,
      subsystem_id INTEGER, only_overdue INTEGER, anchor_date TEXT, node_count INTEGER,
      items_json TEXT, note TEXT, undone_at TEXT, created_by INTEGER, created_at TEXT
    );
    INSERT INTO process_dependencies (id, equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours) VALUES
      (1, 1, 1, 2, 'FS', 0),
      (2, 1, 2, 5, 'FS', 0),
      (3, 1, 2, 3, 'FS', 0),
      (4, 2, 2, 4, 'FS', 0);
  `);
  const insert = db.prepare(`INSERT INTO process_nodes
    (id, equipment_instance_id, operation_name, sequence, status, phase_code, planned_start, planned_end, estimated_hours, assigned_to, required_workstation_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(1, 1, "下料", 1, "completed", "S1", "2026-11-02", "2026-11-03 08:00:00", 4, 7, 3);
  insert.run(2, 1, "组对", 2, "in_progress", "S1", "2026-11-05", "2026-11-08 08:00:00", 8, null, null);
  insert.run(3, 1, "未排程工序", 3, "pending", null, null, null, 2, null, null);
  insert.run(4, 2, "焊接", 1, "pending", "S2", "2026-12-01", "2026-12-05", 10, null, null);
  insert.run(5, 1, "跨月工序", 4, "ready", null, "2026-10-28", "2026-11-02 12:00:00", 3, null, null);
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    put: (path, ...handlers) => routes.set("PUT " + path, handlers),
  };
  return { app, routes };
}

function call(routes, method, path, { params = {}, body = {}, query = {} } = {}) {
  const handlers = routes.get(`${method} ${path}`);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(value) { payload = { status: code, body: value }; } }; },
    json(value) { payload = { status: 200, body: value }; },
  };
  handler({ params, body, query, user: { sub: 1 } }, res, (err) => { error = err; });
  return { payload, error };
}

test("SG.1 甘特数据：按区间取重叠节点，按项目分组", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));

  const result = call(routes, "GET", "/api/schedule/gantt", { query: { from: "2026-11-01", to: "2026-11-30" } });
  assert.equal(result.error, null);
  const body = result.payload.body;
  assert.equal(body.from, "2026-11-01");
  assert.equal(body.to, "2026-11-30");
  assert.equal(body.days.length, 30);
  assert.equal(body.groups.length, 1, "12 月的节点不在区间内");
  const group = body.groups[0];
  assert.equal(group.instance_code, "TBM-1");
  // 按 planned_start 升序：10-28(跨月工序) → 11-02(下料) → 11-05(组对)
  assert.deepEqual(group.nodes.map((node) => node.id), [5, 1, 2], "按计划开始排序");
  const first = group.nodes.find((node) => node.id === 1);
  assert.equal(first.assigned_name, "张三");
  assert.equal(first.workstation_name, "装配工位A");
  // 依赖：两端都要在本次返回集合内（1→2、2→5 满足；2→3 的 3 未排程、2→4 的 4 在 12 月）
  assert.equal(body.total_dependencies, 2);
  assert.deepEqual(body.dependencies.map((dep) => dep.id).sort(), [1, 2]);
  assert.equal(body.dependencies[0].dep_type, "FS");
  db.close();
});

test("SG.2 甘特数据：实例过滤 + 未排程列表", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));

  const all = call(routes, "GET", "/api/schedule/gantt", { query: { from: "2026-11-01", to: "2026-12-31" } });
  assert.equal(all.payload.body.groups.length, 2, "两个项目都有节点");
  assert.equal(all.payload.body.total_dependencies, 3, "2→4 进区间后依赖变 3 条（2→3 仍未排程被排除）");
  assert.equal(all.payload.body.unscheduled.length, 1, "未排程工序单独返回");
  assert.equal(all.payload.body.unscheduled[0].operation_name, "未排程工序");

  const onlyTwo = call(routes, "GET", "/api/schedule/gantt", { query: { from: "2026-11-01", to: "2026-12-31", instance_id: "2" } });
  assert.equal(onlyTwo.payload.body.groups.length, 1);
  assert.equal(onlyTwo.payload.body.groups[0].instance_code, "TBM-2");
  assert.equal(onlyTwo.payload.body.unscheduled.length, 0);

  const withoutUnscheduled = call(routes, "GET", "/api/schedule/gantt", { query: { from: "2026-11-01", to: "2026-12-31", include_unscheduled: "0" } });
  assert.equal(withoutUnscheduled.payload.body.unscheduled.length, 0);
  db.close();
});

test("SG.3 甘特数据：非法区间 / 超长区间被拒", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));
  assert.equal(call(routes, "GET", "/api/schedule/gantt", { query: { from: "2026-11-30", to: "2026-11-01" } }).error.status, 400);
  assert.equal(call(routes, "GET", "/api/schedule/gantt", { query: { from: "2024-01-01", to: "2026-12-31" } }).error.status, 400);
  db.close();
});

test("SG.4 拖拽改期：成功更新计划时间并保留原格式", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));
  const result = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "2" },
    body: { planned_start: "2026-11-08", planned_end: "2026-11-11 08:00:00" },
  });
  assert.equal(result.error, null);
  const row = db.prepare("SELECT planned_start, planned_end FROM process_nodes WHERE id = 2").get();
  assert.equal(row.planned_start, "2026-11-08");
  assert.equal(row.planned_end, "2026-11-11 08:00:00");
  // 2026-11-05（审计 F-03）：拖拽改期必须记批次，便于撤销
  assert.match(String(result.payload.body.batch_no), /^DT-\d{8}-\d{3}$/);
  const batch = db.prepare("SELECT * FROM process_reschedule_batches WHERE batch_no = ?").get(result.payload.body.batch_no);
  assert.equal(batch.node_count, 1);
  const items = JSON.parse(batch.items_json);
  assert.equal(items[0].old_planned_start, "2026-11-05");
  assert.equal(items[0].new_planned_start, "2026-11-08");
  db.close();
});

test("SG.5 拖拽改期：校验（结束早于开始 / 格式 / 已完成 / 不存在）", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));

  const reversed = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "2" }, body: { planned_start: "2026-11-10", planned_end: "2026-11-08" },
  });
  assert.equal(reversed.error.status, 400);
  assert.match(String(reversed.error.message), /不能早于/);

  const badFormat = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "2" }, body: { planned_start: "11/10" },
  });
  assert.equal(badFormat.error.status, 400);

  const completed = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "1" }, body: { planned_start: "2026-11-20" },
  });
  assert.equal(completed.error.status, 400);
  assert.match(String(completed.error.message), /已完成/);

  const missing = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "999" }, body: { planned_start: "2026-11-20" },
  });
  assert.equal(missing.error.status, 404);

  const empty = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", { params: { id: "2" }, body: {} });
  assert.equal(empty.error.status, 400);
  db.close();
});


test("SG.6 拖拽改期：破坏前驱依赖时返回 warnings（不阻断）", () => {
  const db = freshDb();
  const { app, routes } = makeApp();
  registerGanttRoutes(app, db, makeDbHelpers(db));
  // 节点 2 的前驱是 1（计划结束 2026-11-03 08:00），把 2 挪到 11-01 会早于前驱结束
  const result = call(routes, "PUT", "/api/schedule/process-nodes/:id/dates", {
    params: { id: "2" },
    body: { planned_start: "2026-11-01", planned_end: "2026-11-02" },
  });
  assert.equal(result.error, null);
  const warnings = result.payload.body.warnings;
  assert.ok(Array.isArray(warnings) && warnings.length >= 1, "应提示前驱/后继被破坏");
  assert.match(warnings[0], /前驱|后继/);
  // 不阻断：日期仍然写入
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 2").get().planned_start, "2026-11-01");
  db.close();
});
