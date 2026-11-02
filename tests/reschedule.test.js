"use strict";
// tests/reschedule.test.js
// 2026-11-03：批量重排程（只改计划时间，可撤销）
// 覆盖：时间平移格式、候选筛选（未开工 + 过期）、实例/子系统范围、node_ids 白名单、
//       批次日志、撤销（含"节点已被改过则跳过"）、anchor_date 对齐模式、参数校验。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  registerRescheduleRoutes,
  initRescheduleLog,
  shiftDateTime,
  collectCandidates,
} = require("../services/schedule/reschedule");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      operation_name TEXT,
      status TEXT,
      planned_start TEXT,
      planned_end TEXT,
      subsystem_id INTEGER,
      updated_at TEXT
    );
    INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'T-001', '测试机一'), (2, 'T-002', '测试机二');
  `);
  initRescheduleLog(db);
  initRescheduleLog(db); // 幂等
  return db;
}

function makeApp() {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set("GET " + path, handlers),
    post: (path, ...handlers) => routes.set("POST " + path, handlers),
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
  handler({ params, body, query, user: { sub: 1, uid: 1 } }, res, (err) => { error = err; });
  return { payload, error };
}

function seedOverdue(db) {
  const insert = db.prepare("INSERT INTO process_nodes (id, equipment_instance_id, operation_name, status, planned_start, planned_end, subsystem_id) VALUES (?,?,?,?,?,?,?)");
  insert.run(1, 1, "下料", "ready", "2026-07-01", "2026-07-01 04:00:00", 3);
  insert.run(2, 1, "组对", "pending", "2026-07-02", "2026-07-02 08:00:00", 3);
  insert.run(3, 1, "焊接", "in_progress", "2026-07-03", "2026-07-03 08:00:00", 3); // 已开工 → 不处理
  insert.run(4, 1, "涂装", "completed", "2026-06-01", "2026-06-01 08:00:00", 3); // 已完成 → 不处理
  insert.run(5, 2, "下料", "ready", "2026-09-01", "2026-09-01 04:00:00", 7);
  insert.run(6, 2, "未来任务", "pending", "2099-01-01", "2099-01-01 08:00:00", 7); // 未过期 → 只处理过期时不选
}

test("RS.1 shiftDateTime：保留原格式（含秒），不认识的格式原样返回", () => {
  assert.equal(shiftDateTime("2026-07-01", 10), "2026-07-11");
  assert.equal(shiftDateTime("2026-07-01 04:00:00", 132), "2026-11-10 04:00:00");
  assert.equal(shiftDateTime("2026-07-01 04:00", 1), "2026-07-02 04:00");
  assert.equal(shiftDateTime(null, 5), null);
  assert.equal(shiftDateTime("不是日期", 5), "不是日期");
});

test("RS.2 候选筛选：只选未开工且过期的节点，支持实例范围", () => {
  const db = freshDb();
  seedOverdue(db);
  const all = collectCandidates(db, { instanceId: null, shiftDays: 10, statuses: ["pending", "ready"], onlyOverdue: true });
  assert.equal(all.items.length, 3, "ready×2 + pending×1（instance1 两条、instance2 一条），排除 in_progress/completed/未过期");
  assert.equal(all.shiftDays, 10);

  const onlyInstance2 = collectCandidates(db, { instanceId: 2, shiftDays: 10, statuses: ["pending", "ready"], onlyOverdue: true });
  assert.equal(onlyInstance2.items.length, 1);
  assert.equal(onlyInstance2.items[0].instance_code, "T-002");

  const onlyOverdueFalse = collectCandidates(db, { instanceId: 2, shiftDays: 10, statuses: ["pending", "ready"], onlyOverdue: false });
  assert.equal(onlyOverdueFalse.items.length, 2, "不过期过滤时未来任务也选进来");
  db.close();
});

test("RS.3 anchor_date 模式：把最早计划开始对齐到目标日期", () => {
  const db = freshDb();
  seedOverdue(db);
  const plan = collectCandidates(db, { instanceId: 1, shiftDays: null, anchorDate: "2026-11-10", statuses: ["pending", "ready"], onlyOverdue: true });
  // 实例1 最早 2026-07-01 → 2026-11-10 = 132 天
  assert.equal(plan.shiftDays, 132);
  assert.equal(plan.items[0].new_planned_start, "2026-11-10");
  assert.equal(plan.items[0].new_planned_end, "2026-11-10 04:00:00");
  db.close();
});

test("RS.4 预览接口：返回统计与前 300 条明细", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);
  const preview = call(routes, "GET", "/api/schedule/reschedule/preview", { query: { shift_days: "30" } });
  assert.equal(preview.payload.status, 200);
  assert.equal(preview.payload.body.stats.total, 3);
  assert.equal(preview.payload.body.stats.instance_count, 2);
  assert.equal(preview.payload.body.items.length, 3);
  assert.equal(preview.payload.body.truncated, false);
  db.close();
});

test("RS.5 应用：更新计划时间 + 写批次日志 + 不影响状态/实际时间", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);
  const applied = call(routes, "POST", "/api/schedule/reschedule/apply", { body: { shift_days: 30, note: "单测" } });
  assert.equal(applied.error, null);
  assert.equal(applied.payload.body.node_count, 3);
  assert.equal(applied.payload.body.shift_days, 30);

  const row = db.prepare("SELECT * FROM process_nodes WHERE id = 1").get();
  assert.equal(row.planned_start, "2026-07-31");
  assert.equal(row.planned_end, "2026-07-31 04:00:00");
  assert.equal(row.status, "ready", "状态不变");

  const untouched = db.prepare("SELECT * FROM process_nodes WHERE id = 3").get();
  assert.equal(untouched.planned_start, "2026-07-03", "已开工节点不动");

  const batch = db.prepare("SELECT * FROM process_reschedule_batches").get();
  assert.equal(batch.node_count, 3);
  assert.equal(batch.shift_days, 30);
  assert.ok(batch.batch_no.startsWith("RS-"));
  assert.equal(JSON.parse(batch.items_json).length, 3);
  db.close();
});

test("RS.6 node_ids 白名单：只应用指定节点", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);
  const applied = call(routes, "POST", "/api/schedule/reschedule/apply", { body: { shift_days: 5, node_ids: [1, 2] } });
  assert.equal(applied.payload.body.node_count, 2);
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 1").get().planned_start, "2026-07-06");
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 5").get().planned_start, "2026-09-01", "未选中的不动");
  db.close();
});

test("RS.7 撤销：还原到原时间；二次撤销被拒；节点被改过则跳过", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);
  const applied = call(routes, "POST", "/api/schedule/reschedule/apply", { body: { shift_days: 30 } });
  const batchId = applied.payload.body.batch_id;

  // 人为改掉一个节点，验证撤销会跳过
  db.prepare("UPDATE process_nodes SET planned_start = '2026-12-31' WHERE id = 2").run();

  const undone = call(routes, "POST", "/api/schedule/reschedule/batches/:id/undo", { params: { id: String(batchId) } });
  assert.equal(undone.error, null);
  assert.equal(undone.payload.body.restored, 2);
  assert.equal(undone.payload.body.skipped, 1);
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 1").get().planned_start, "2026-07-01");
  assert.equal(db.prepare("SELECT planned_start FROM process_nodes WHERE id = 2").get().planned_start, "2026-12-31", "被改过的不覆盖");

  const again = call(routes, "POST", "/api/schedule/reschedule/batches/:id/undo", { params: { id: String(batchId) } });
  assert.equal(again.error.status, 400);
  db.close();
});

test("RS.8 参数校验：天数范围 / 状态不允许 / 无候选 / anchor 格式", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);

  assert.equal(call(routes, "GET", "/api/schedule/reschedule/preview", { query: { shift_days: "0" } }).error.status, 400);
  assert.equal(call(routes, "GET", "/api/schedule/reschedule/preview", { query: { shift_days: "999" } }).error.status, 400);
  assert.equal(call(routes, "GET", "/api/schedule/reschedule/preview", { query: { shift_days: "5", statuses: "completed" } }).error.status, 400);
  assert.equal(call(routes, "GET", "/api/schedule/reschedule/preview", { query: { anchor_date: "11/10" } }).error.status, 400);

  db.prepare("DELETE FROM process_nodes").run();
  const empty = call(routes, "POST", "/api/schedule/reschedule/apply", { body: { shift_days: 5 } });
  assert.equal(empty.error.status, 400);
  db.close();
});

test("RS.9 批次历史接口：列出最近的批次", () => {
  const db = freshDb();
  seedOverdue(db);
  const { app, routes } = makeApp();
  registerRescheduleRoutes(app, db);
  call(routes, "POST", "/api/schedule/reschedule/apply", { body: { shift_days: 7 } });
  const list = call(routes, "GET", "/api/schedule/reschedule/batches", { query: {} });
  assert.equal(list.payload.body.total, 1);
  assert.equal(list.payload.body.items[0].node_count, 3);
  db.close();
});
