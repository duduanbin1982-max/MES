"use strict";
// tests/workOrderGovernance.test.js
// 2026-11-05（工单管理审计整改）：权限放行计划员、派工/创建/取消/报工校验、计划日期补齐。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const workOrderService = require("../services/workOrderService");
const guards = require("../middleware/guards");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT);
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, instance_id INTEGER, name_zh TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT NOT NULL UNIQUE, equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER, subsystem_id INTEGER, title TEXT NOT NULL, description TEXT, workstation_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', priority INTEGER DEFAULT 3, planned_start TEXT, planned_end TEXT,
      actual_start TEXT, actual_end TEXT, estimated_hours REAL, actual_hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_to INTEGER, dispatched_at TEXT, quantity_planned INTEGER DEFAULT 1, quantity_completed INTEGER DEFAULT 0
    );
    CREATE TABLE work_order_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER NOT NULL, operator_id INTEGER,
      action TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), hours_worked REAL, notes TEXT,
      photos TEXT, quantity_completed INTEGER DEFAULT 0, defect_quantity INTEGER DEFAULT 0
    );
    CREATE TABLE resource_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, workstation_id INTEGER,
      equipment_instance_id INTEGER, assigned_at TEXT DEFAULT (datetime('now')), released_at TEXT,
      status TEXT DEFAULT 'active', notes TEXT, work_order_id INTEGER
    );
    CREATE TABLE weld_records (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, weld_no TEXT, welder_id INTEGER, material_lot_id INTEGER, weld_length_mm INTEGER);
    INSERT INTO users (id, username, full_name, role, is_active) VALUES
      (1, 'foreman1', '张主任', 'foreman', 1), (2, 'worker1', '王师傅', 'worker', 1), (3, 'off', '停用人员', 'worker', 0);
    INSERT INTO equipment_instances (id, instance_code, instance_name, status) VALUES (1, 'TBM-001', '一号机', 'assembly');
    INSERT INTO workstations (id, name, is_active) VALUES (10, '工位10', 1), (11, '停用工位', 0);
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status) VALUES
      (1, 'WO-001', 1, '待派工单', 'pending'),
      (2, 'WO-002', 1, '已完成工单', 'completed'),
      (3, 'WO-003', 1, '已取消工单', 'cancelled');
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status, planned_end, estimated_hours)
      VALUES (4, 'WO-004', 1, '缺开始的工单', 'pending', '2026-06-17 08:00:00', 8);
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status, planned_start, estimated_hours)
      VALUES (5, 'WO-005', 1, '缺结束的工单', 'dispatched', '2026-06-10 08:00:00', 4);
  `);
  return db;
}

function createAuth() {
  return {
    onlyForemanOrAdmin: (req, _res, next) => { req.user = { sub: 1, role: 'foreman' }; next(); },
    onlyForemanAdminOrPlanner: (req, _res, next) => { req.user = { sub: 1, role: 'planner' }; next(); },
    onlyWelder: (req, _res, next) => { req.user = { sub: 2, role: 'welder' }; next(); },
    foremanOrWorker: (req, _res, next) => { req.user = { sub: 2, role: 'worker' }; next(); },
  };
}

function createApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    app[method] = (route, ...handlers) => {
      const key = method.toUpperCase() + " " + route;
      routes.set(key, [...(routes.get(key) || []), ...handlers]);
    };
  }
  workOrderService.register(app, db, createAuth());
  return (method, route) => routes.get(method.toUpperCase() + " " + route);
}

async function invoke(handlers, request = {}) {
  const req = { params: {}, query: {}, body: {}, ...request };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let index = 0;
  await new Promise((resolve, reject) => {
    const next = (error) => {
      if (error) return reject(error);
      const handler = handlers[index++];
      if (!handler) return resolve();
      let advanced = false;
      const advance = (err) => {
        if (advanced) return;
        advanced = true;
        if (err) return reject(err);
        try { next(err); } catch (error_) { reject(error_); }
      };
      try {
        const result = handler(req, res, advance);
        if (result && typeof result.then === "function") result.then(() => advance(), advance);
      } catch (error_) {
        reject(error_);
      }
    };
    next();
  });
  return { status: res.statusCode, body: res.body };
}

async function runHandler(app, method, route, request) {
  const handlers = app(method, route);
  if (!handlers) throw new Error("No route: " + method + " " + route);
  try {
    return await invoke(handlers, request);
  } catch (error) {
    return { error };
  }
}

test("WG.1 守卫：计划员可派工/创建，非授权角色被拒且状态码是 403", () => {
  const allowed = { user: { role: 'planner' } };
  assert.equal(guards.onlyForemanAdminOrPlanner(allowed, {}, () => {}), undefined);
  const denied = { user: { role: 'worker' } };
  assert.throws(() => guards.onlyForemanAdminOrPlanner(denied, {}, () => {}), (error) => error.status === 403 && /需要车间主任、计划员或管理员/.test(error.message));
});

test("WG.2 创建：必填/项目存在/计划顺序/优先级/工单号唯一 校验", async () => {
  const db = createDatabase();
  const app = createApp(db);

  const missing = await runHandler(app, "POST", "/api/work_orders", { body: { wo_code: 'X' } });
  assert.equal(missing.error.status, 400);

  const noInstance = await runHandler(app, "POST", "/api/work_orders", { body: { wo_code: 'X', equipment_instance_id: 999, title: 't' } });
  assert.equal(noInstance.error.status, 404);

  const reversed = await runHandler(app, "POST", "/api/work_orders", { body: { wo_code: 'X', equipment_instance_id: 1, title: 't', planned_start: '2026-06-10', planned_end: '2026-06-09' } });
  assert.equal(reversed.error.status, 400);

  const dup = await runHandler(app, "POST", "/api/work_orders", { body: { wo_code: 'WO-001', equipment_instance_id: 1, title: 't' } });
  assert.equal(dup.error.status, 400);

  const badPriority = await runHandler(app, "POST", "/api/work_orders", { body: { wo_code: 'X', equipment_instance_id: 1, title: 't', priority: 5 } });
  assert.equal(badPriority.error.status, 400);

  const ok = await runHandler(app, "POST", "/api/work_orders", {
    body: { wo_code: 'WO-NEW', equipment_instance_id: 1, title: '新工单', planned_start: '2026-06-10 08:00:00', planned_end: '2026-06-12 08:00:00', priority: 2, estimated_hours: 16 },
  });
  assert.ok(ok.body && ok.body.id, "创建成功应返回 id");
  const row = db.prepare("SELECT * FROM work_orders WHERE wo_code = 'WO-NEW'").get();
  assert.equal(row.planned_end, '2026-06-12 08:00:00');
  assert.equal(row.priority, 2);
  db.close();
});

test("WG.3 派工：状态/人员/工位/重复派工 校验 + force 越过", async () => {
  const db = createDatabase();
  const app = createApp(db);

  const cancelled = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "3" }, body: { user_id: 2, workstation_id: 10 } });
  assert.equal(cancelled.error.status, 400);

  const inactive = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "1" }, body: { user_id: 3, workstation_id: 10 } });
  assert.equal(inactive.error.status, 400);
  assert.match(String(inactive.error.message), /停用/);

  const inactiveWs = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "1" }, body: { user_id: 2, workstation_id: 11 } });
  assert.equal(inactiveWs.error.status, 400);

  // 先占一张工单，再给同一人派另一张
  const first = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "1" }, body: { user_id: 2, workstation_id: 10, planned_start: '2026-06-01' } });
  assert.ok(first.body && first.body.status === 'dispatched', first.error && first.error.message);
  const busy = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "4" }, body: { user_id: 2, workstation_id: 10 } });
  assert.equal(busy.error.status, 400);
  assert.match(String(busy.error.message), /已在工单/);
  const forced = await runHandler(app, "PUT", "/api/work_orders/:id/dispatch", { params: { id: "4" }, body: { user_id: 2, workstation_id: 10, force: true } });
  assert.ok(forced.body && forced.body.status === 'dispatched', forced.error && forced.error.message);
  db.close();
});

test("WG.4 取消：pending→cancelled 成功；completed / cancelled 被拒", async () => {
  const db = createDatabase();
  const app = createApp(db);
  const ok = await runHandler(app, "POST", "/api/work_orders/:id/cancel", { params: { id: "1" }, body: { comment: '客户取消' } });
  assert.equal(ok.body.work_order.status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM work_orders WHERE id = 1').get().status, 'cancelled');

  for (const id of ["2", "3"]) {
    const rejected = await runHandler(app, "POST", "/api/work_orders/:id/cancel", { params: { id }, body: {} });
    assert.equal(rejected.error.status, 400);
  }
  db.close();
});

test("WG.5 计划日期补齐：dryRun 预览、apply 写库、两边都有计划的不动", async () => {
  const db = createDatabase();
  const app = createApp(db);
  const dry = await runHandler(app, "POST", "/api/work_orders/backfill-dates", { query: { dryRun: '1' }, body: {} });
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.changed_count, 2);
  assert.equal(db.prepare('SELECT planned_start FROM work_orders WHERE id = 4').get().planned_start, null, "dryRun 不写库");

  const applied = await runHandler(app, "POST", "/api/work_orders/backfill-dates", { body: {} });
  assert.equal(applied.body.updated, 2);
  const wo4 = db.prepare('SELECT planned_start, planned_end FROM work_orders WHERE id = 4').get();
  assert.equal(wo4.planned_start, '2026-06-17 00:00:00', '结束 - 8h 回推开始');
  const wo5 = db.prepare('SELECT planned_start, planned_end FROM work_orders WHERE id = 5').get();
  assert.equal(wo5.planned_end, '2026-06-10 12:00:00', '开始 + 4h 推算结束');
  db.close();
});

test("WG.6 报工：负数工时/数量被拒；超计划返回 over_reported", async () => {
  const db = createDatabase();
  const app = createApp(db);
  db.prepare("UPDATE work_orders SET status = 'in_progress' WHERE id = 1").run();

  const negative = await runHandler(app, "POST", "/api/work_orders/:id/report", { params: { id: "1" }, body: { user_id: 2, hours_worked: -1, quantity_completed: 1 } });
  assert.equal(negative.error.status, 400);

  const negativeQty = await runHandler(app, "POST", "/api/work_orders/:id/report", { params: { id: "1" }, body: { user_id: 2, hours_worked: 1, quantity_completed: -2 } });
  assert.equal(negativeQty.error.status, 400);

  const ok = await runHandler(app, "POST", "/api/work_orders/:id/report", { params: { id: "1" }, body: { user_id: 2, hours_worked: 2, quantity_completed: 3 } });
  assert.equal(ok.body.over_reported, true, "计划 1 件、报 3 件 → 超报标记");
  assert.equal(ok.body.quantity_completed, 3);
  db.close();
});
