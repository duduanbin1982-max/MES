"use strict";
// tests/workOrderProcessNode.test.js
// 2026-11-05：工单 ↔ 工序 1:1 关联（列/校验/选项/关联编辑/回填）。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const workOrderService = require("../services/workOrderService");

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT);
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, instance_id INTEGER, name_zh TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, subsystem_id INTEGER, operation_name TEXT,
      status TEXT, phase_code TEXT, planned_start TEXT, planned_end TEXT, sequence INTEGER
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT NOT NULL UNIQUE, equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER, subsystem_id INTEGER, title TEXT NOT NULL, description TEXT, workstation_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending', priority INTEGER DEFAULT 3, planned_start TEXT, planned_end TEXT,
      actual_start TEXT, actual_end TEXT, estimated_hours REAL, actual_hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_to INTEGER, dispatched_at TEXT, quantity_planned INTEGER DEFAULT 1, quantity_completed INTEGER DEFAULT 0,
      process_node_id INTEGER REFERENCES process_nodes(id)
    );
    CREATE TABLE work_order_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, operator_id INTEGER, action TEXT,
      timestamp TEXT DEFAULT (datetime('now')), hours_worked REAL, notes TEXT, photos TEXT,
      quantity_completed INTEGER DEFAULT 0, defect_quantity INTEGER DEFAULT 0
    );
    CREATE TABLE resource_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, workstation_id INTEGER, equipment_instance_id INTEGER,
      assigned_at TEXT, released_at TEXT, status TEXT, notes TEXT, work_order_id INTEGER
    );
    INSERT INTO equipment_instances VALUES (1, 'TBM-1', '一号机', 'assembly'), (2, 'TBM-2', '二号机', 'assembly');
    INSERT INTO equipment_subsystems VALUES (3, 1, '前盾'), (4, 1, '推进');
    INSERT INTO users (id, username, full_name, role) VALUES (1, 'f', '主任', 'foreman');
    INSERT INTO process_nodes (id, equipment_instance_id, subsystem_id, operation_name, status, sequence) VALUES
      (101, 1, 3, '下料', 'ready', 1),
      (102, 1, 3, '卷制/成型', 'pending', 2),
      (103, 1, 3, '焊接', 'pending', 3),
      (201, 2, 1, '下料', 'ready', 1);
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, subsystem_id, title, status) VALUES
      (1, 'WO-A', 1, 3, '前盾下料+卷制+焊接', 'pending'),
      (2, 'WO-B', 1, 4, '推进油缸组对', 'pending'),
      (3, 'WO-C', 1, NULL, '焊接', 'cancelled');
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
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (route, ...handlers) => routes.set(method.toUpperCase() + ' ' + route, [...(routes.get(method.toUpperCase() + ' ' + route) || []), ...handlers]);
  }
  workOrderService.register(app, db, createAuth());
  return (method, route) => routes.get(method.toUpperCase() + ' ' + route);
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
        if (result && typeof result.then === 'function') result.then(() => advance(), advance);
      } catch (error_) { reject(error_); }
    };
    next();
  });
  return { status: res.statusCode, body: res.body };
}

async function call(app, method, route, request) {
  const handlers = app(method, route);
  if (!handlers) throw new Error('No route: ' + method + ' ' + route);
  try { return await invoke(handlers, request); }
  catch (error) { return { error }; }
}

test('PN.1 创建：关联同项目工序，列表/详情带工序名', async () => {
  const db = createDatabase();
  const app = createApp(db);
  const created = await call(app, 'POST', '/api/work_orders', {
    body: { wo_code: 'WO-N1', equipment_instance_id: 1, title: '新工单', process_node_id: 102 },
  });
  assert.ok(created.body && created.body.id, created.error && created.error.message);
  const row = db.prepare("SELECT process_node_id FROM work_orders WHERE wo_code = 'WO-N1'").get();
  assert.equal(row.process_node_id, 102);

  const list = await call(app, 'GET', '/api/work_orders', {});
  const item = list.body.find((entry) => entry.wo_code === 'WO-N1');
  assert.equal(item.process_node_name, '卷制/成型');
  const detail = await call(app, 'GET', '/api/work_orders/:id', { params: { id: String(created.body.id) } });
  assert.equal(detail.body.process_node_name, '卷制/成型');
  db.close();
});

test('PN.2 创建校验：跨项目 400 / 工序不存在 404 / 工序已被占用 400', async () => {
  const db = createDatabase();
  const app = createApp(db);
  const cross = await call(app, 'POST', '/api/work_orders', { body: { wo_code: 'WO-X', equipment_instance_id: 2, title: 't', process_node_id: 101 } });
  assert.equal(cross.error.status, 400);
  const missing = await call(app, 'POST', '/api/work_orders', { body: { wo_code: 'WO-Y', equipment_instance_id: 1, title: 't', process_node_id: 999 } });
  assert.equal(missing.error.status, 404);
  db.prepare("UPDATE work_orders SET process_node_id = 101 WHERE id = 1").run();
  const occupied = await call(app, 'POST', '/api/work_orders', { body: { wo_code: 'WO-Z', equipment_instance_id: 1, title: 't', process_node_id: 101 } });
  assert.equal(occupied.error.status, 400);
  assert.match(String(occupied.error.message), /已被工单/);
  db.close();
});

test('PN.3 关联编辑：建立/改绑/解除；冲突与跨项目被拒', async () => {
  const db = createDatabase();
  const app = createApp(db);
  const linked = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: 101 } });
  assert.equal(linked.body.process_node_id, 101);
  assert.equal(linked.body.process_node_name, '下料');

  const rebind = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: 103 } });
  assert.equal(rebind.body.process_node_id, 103);

  const cross = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: 201 } });
  assert.equal(cross.error.status, 400);

  db.prepare("UPDATE work_orders SET process_node_id = 101 WHERE id = 2").run();
  const conflict = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: 101 } });
  assert.equal(conflict.error.status, 400);

  const cleared = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: null } });
  assert.equal(cleared.body.process_node_id, null);
  assert.equal(db.prepare('SELECT process_node_id FROM work_orders WHERE id = 1').get().process_node_id, null);
  db.close();
});

test('PN.4 工序选项：按项目过滤，only_unlinked 排除已关联', async () => {
  const db = createDatabase();
  const app = createApp(db);
  db.prepare("UPDATE work_orders SET process_node_id = 101 WHERE id = 1").run();
  const all = await call(app, 'GET', '/api/work_orders/process-node-options', { query: { equipment_instance_id: '1' } });
  assert.equal(all.body.length, 3);
  const unlinked = await call(app, 'GET', '/api/work_orders/process-node-options', { query: { equipment_instance_id: '1', only_unlinked: '1' } });
  assert.deepEqual(unlinked.body.map((node) => node.id).sort(), [102, 103]);
  const missing = await call(app, 'GET', '/api/work_orders/process-node-options', { query: {} });
  assert.equal(missing.error.status, 400);
  db.close();
});

test('PN.5 回填：dryRun/apply，按标题中工序名最先出现者匹配，无匹配跳过', async () => {
  const db = createDatabase();
  const app = createApp(db);
  const dry = await call(app, 'POST', '/api/work_orders/backfill-process-nodes', { query: { dryRun: '1' }, body: {} });
  assert.equal(dry.body.dry_run, true);
  // WO-A(前盾下料+卷制+焊接) 有 3 个候选 → 选标题中最先出现的「下料」=101；WO-B 子系统 4 无节点同名 → 跳过；WO-C 已取消不参与
  assert.equal(dry.body.changed_count, 1);
  assert.equal(dry.body.changes[0].process_node_id, 101);
  assert.equal(dry.body.changes[0].candidates, 2, "标题含「下料」「焊接」两个候选，取最先出现的下料");
  assert.ok(dry.body.skipped.some((entry) => entry.wo_code === 'WO-B'));
  assert.equal(db.prepare('SELECT process_node_id FROM work_orders WHERE id = 1').get().process_node_id, null, 'dryRun 不写库');

  const applied = await call(app, 'POST', '/api/work_orders/backfill-process-nodes', { body: {} });
  assert.equal(applied.body.updated, 1);
  assert.equal(db.prepare('SELECT process_node_id FROM work_orders WHERE id = 1').get().process_node_id, 101);
  db.close();
});

test('PN.6 工单取消后工序占用释放，可被新工单关联', async () => {
  const db = createDatabase();
  const app = createApp(db);
  await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '1' }, body: { process_node_id: 101 } });
  await call(app, 'POST', '/api/work_orders/:id/cancel', { params: { id: '1' }, body: {} });
  const relinked = await call(app, 'PUT', '/api/work_orders/:id/process-node', { params: { id: '2' }, body: { process_node_id: 101 } });
  assert.equal(relinked.body.process_node_id, 101, '原工单已取消，工序可重新关联');
  db.close();
});
