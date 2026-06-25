'use strict';

/**
 * materialService.test.js
 * P0-#2 验: POST /api/material_movements 事务内同步 inventory.quantity
 * 6 个用例: receive/issue/transfer/adjust/return/issue-overflow
 * 用 in-memory DB, 不动 mes.db
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, spec TEXT, unit TEXT, safety_stock REAL DEFAULT 0, reorder_point REAL DEFAULT 0)');
  db.exec('CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT DEFAULT "pending", notes TEXT)');
  db.exec('CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT "available", last_updated TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT)');
  db.exec('CREATE TABLE material_units (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, from_unit TEXT NOT NULL, to_unit TEXT NOT NULL, factor REAL NOT NULL, notes TEXT, created_at TEXT DEFAULT \'2026-01-01 00:00:00\', UNIQUE(material_id, from_unit, to_unit))');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  return db;
}

function makeApp(db) {
  const fakePath = path.resolve(__dirname, '../db');
  require.cache[fakePath] = { exports: db, loaded: true, id: fakePath, filename: fakePath, children: [], paths: [] };
  const svc = require('../services/materialService');
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = { method: 'get', handler: h }; },
    post: (p, h) => { routes['POST ' + p] = { method: 'post', handler: h }; },
    put: (p, h) => { routes['PUT ' + p] = { method: 'put', handler: h }; },
    patch: (p, h) => { routes['PATCH ' + p] = { method: 'patch', handler: h }; },
    delete: (p, h) => { routes['DELETE ' + p] = { method: 'delete', handler: h }; },
  };
  // 旧 key 兼容: ctx.routes['/api/xxx'] 默认 GET 行为
  const _origGet = (k) => routes['GET ' + k] || routes[k];
  svc.register(app, db);
  return { app, routes };
}

function mkReqRes(body, opts = {}) {
  const req = { body, query: opts.query || {}, params: opts.params || {}, user: 'user' in opts ? opts.user : { uid: 1, role: 'admin' } };
  let status = 200, json = null;
  const res = { status: (s) => { status = s; return res; }, json: (j) => { json = j; return res; }, _get: () => ({ status, json }) };
  return { req, res, getResult: () => ({ status, json }) };
}

let _db, ctx;
test.beforeEach(() => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/db') && !k.includes('better-sqlite3') && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  _db = freshDb();
  _db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (?, ?, ?)').run(1, 'T-001', '测试物料');
  _db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (?, ?, ?, ?)').run(1, 1, 'LOT-001', 100);
  ctx = makeApp(_db);
});

test('P0-2-1 receive: 库存 + 100, 写 movement receive', () => {
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'receive', quantity: 100, to_location: '主仓库-A-01', unit: 'pcs' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  const { status, json } = getResult();
  assert.equal(status, 200, 'expect 200');
  assert.ok(json.id, 'movement id 应返回');
  const inv = _db.prepare('SELECT * FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 100, 'inventory 应新增 100');
  assert.equal(inv.status, 'available');
});

test('P0-2-2 issue: 在 receive 后 issue 30, 库存剩 70', () => {
  let { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'receive', quantity: 100, to_location: '主仓库-A-01', unit: 'pcs' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  ({ req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'issue', quantity: 30, from_location: '主仓库-A-01', work_order_id: 1 }));
  ctx.routes['POST /api/material_movements'].handler(req, res);
  const inv = _db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 70, 'issue 后剩 70');
});

test('P0-2-3 issue-overflow: 库存不足返回 400, 事务回滚', () => {
  let { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'receive', quantity: 10, to_location: '主仓库-A-01' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  ({ req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'issue', quantity: 50, from_location: '主仓库-A-01' }));
  ctx.routes['POST /api/material_movements'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 400, 'overflow 应 400');
  assert.match(r.json.error, /库存不足/);
  const inv = _db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1').get();
  assert.equal(inv.quantity, 10, '事务回滚, 库存仍 10');
  const mv = _db.prepare("SELECT COUNT(*) AS c FROM material_movements WHERE movement_type = 'issue'").get();
  assert.equal(mv.c, 0, '失败的 issue 不应写 movement');
});

test('P0-2-4 transfer: from 50 -> 20, to 0 -> 30', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 50, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'transfer', quantity: 30, from_location: 'A', to_location: 'B' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare('SELECT quantity FROM inventory WHERE location = ?').get('A');
  const b = _db.prepare('SELECT quantity FROM inventory WHERE location = ?').get('B');
  assert.equal(a.quantity, 20, 'A 剩 20');
  assert.equal(b.quantity, 30, 'B 增 30');
});

test('P0-2-5 adjust: 盘点把 100 改成 80', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'adjust', quantity: 80, to_location: 'A' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const inv = _db.prepare('SELECT quantity, status FROM inventory WHERE location = ?').get('A');
  assert.equal(inv.quantity, 80, 'adjust 后 = 80');
  assert.equal(inv.status, 'available', 'adjust 后 status 仍 available');
});

test('P0-2-6 return: 退料同 receive, 库存 +5', () => {
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'return', quantity: 5, to_location: '主仓库-A-01' });
  ctx.routes['POST /api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const inv = _db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 5, 'return 后 = 5');
});
test('P1-5-1 allocate: 100 available -> 70 available + 30 allocated', () => {
  // 准备: 100 available
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 30, location: 'A' });
  ctx.routes['POST /api/inventory/allocate'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='available'").get();
  const b = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='allocated'").get();
  assert.equal(a.quantity, 70);
  assert.equal(b.quantity, 30);
});

test('P1-5-2 allocate 超量应 400 + 事务回滚', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 10, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 50 });
  ctx.routes['POST /api/inventory/allocate'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 400);
  assert.match(r.json.error, /不足/);
  // 状态应没变
  const cnt = _db.prepare("SELECT COUNT(*) AS c FROM inventory WHERE material_lot_id=1 AND status='allocated'").get();
  assert.equal(cnt.c, 0, '事务回滚, allocated 行不应存在');
});

test('P1-5-3 release: 30 allocated -> 30 available', () => {
  // 准备: 100 available + 30 allocated
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 30, 'allocated')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 30 });
  ctx.routes['POST /api/inventory/release'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='available'").get();
  const b = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='allocated'").get();
  assert.equal(a.quantity, 130, 'release 后 available 应 +30');
  assert.equal(b.quantity, 0, 'allocated 应归 0');
});

test('P1-5-4 release 超量应 400', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 5, 'allocated')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 50 });
  ctx.routes['POST /api/inventory/release'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 400);
  assert.match(r.json.error, /不足/);
});
// ---------------- P2-7 + P2-8 ----------------

test("P2-7-1 work_order_lots: 工单关联的 lot 追溯", () => {
  _db.prepare("INSERT INTO work_orders (id, wo_code) VALUES (1, 'WO-001')").run();
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, received_date) VALUES (2, 1, 'L-1', 100, '件', '2026-01-01')").run();
  _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, work_order_id, created_at) VALUES (2, 'issue', 10, '件', 1, '2026-01-15')").run();
  _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, work_order_id, created_at) VALUES (2, 'issue', 15, '件', 1, '2026-01-20')").run();
  const { req, res, getResult } = mkReqRes({}, { params: { id: '1' } });
  ctx.routes['GET /api/work_orders/:id/lots'].handler(req, res);
  const r = getResult().json;
  assert.equal(r.work_order.wo_code, "WO-001");
  assert.equal(r.movements.length, 2);
  assert.equal(r.lot_summary["L-1"], 25);
});

test("P2-7-2 work_order_lots: 工单不存在返 404", () => {
  const { req, res, getResult } = mkReqRes({}, { params: { id: '999' } });
  ctx.routes['GET /api/work_orders/:id/lots'].handler(req, res);
  assert.equal(getResult().status, 404);
});

test("P2-8-1 stagnant: 91 天无 movement 标呆滞", () => {
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, received_date) VALUES (3, 1, 'OLD-1', 50, '件', '2026-03-15')").run();
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (3, 'A', 50, '件', 'available')").run();
  const { req, res, getResult } = mkReqRes({});
  ctx.routes['GET /api/inventory/stagnant'].handler(req, res);
  const r = getResult().json;
  const old1 = r.items.find(x => x.lot_no === "OLD-1");
  assert.ok(old1, "OLD-1 应收录");
  assert.ok(old1.idle_days >= 90, "idle_days 应 >= 90, 实际 " + old1.idle_days);
});

test("P2-8-2 stagnant: 30 天前有 movement 不算呆滞", () => {
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, received_date) VALUES (4, 1, 'FRESH-1', 50, '件', '2026-05-25')").run();
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (4, 'A', 50, '件', 'available')").run();
  _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, created_at) VALUES (4, 'issue', 5, '件', '2026-06-20')").run();
  const { req, res, getResult } = mkReqRes({});
  ctx.routes['GET /api/inventory/stagnant'].handler(req, res);
  const r = getResult().json;
  assert.ok(!r.items.some(x => x.lot_no === "FRESH-1"), "30 天前有 movement 不应算呆滞");
});

// ---------------- P2-9 单位换算 ----------------

test("P2-9-1 units_list: 列出物料的全部换算", () => {
  _db.prepare("INSERT INTO material_units (material_id, from_unit, to_unit, factor) VALUES (1, '卷', '吨', 5)").run();
  _db.prepare("INSERT INTO material_units (material_id, from_unit, to_unit, factor) VALUES (1, '箱', '件', 24)").run();
  const { req, res, getResult } = mkReqRes({}, { params: { id: '1' } });
  ctx.routes['GET /api/materials/:id/units'].handler(req, res);
  const r = getResult().json;
  assert.equal(r.count, 2);
  assert.equal(r.items[0].from_unit, "卷");
  assert.equal(r.items[0].factor, 5);
});

test("P2-9-2 units_create: 加新换算返回 200", () => {
  const { req, res, getResult } = mkReqRes({ material_id: 1, from_unit: "kg", to_unit: "g", factor: 1000 });
  ctx.routes['POST /api/material_units'].handler(req, res);
  assert.equal(getResult().status, 200);
  const rows = _db.prepare("SELECT * FROM material_units").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].factor, 1000);
});

test("P2-9-3 units_create: from==to 应 400", () => {
  const { req, res, getResult } = mkReqRes({ material_id: 1, from_unit: "件", to_unit: "件", factor: 1 });
  ctx.routes['POST /api/material_units'].handler(req, res);
  assert.equal(getResult().status, 400);
});

test("P2-9-4 units_create: 缺 factor 应 400", () => {
  const { req, res, getResult } = mkReqRes({ material_id: 1, from_unit: "kg", to_unit: "g" });
  ctx.routes['POST /api/material_units'].handler(req, res);
  assert.equal(getResult().status, 400);
});

// ---------------- P3-1 ----------------

test("P3-1-1 未登录应 401", () => {
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: "receive", quantity: 10, to_location: "A" }, { user: undefined });
  ctx.routes["GET /api/material_movements"].handler(req, res);
  assert.equal(getResult().status, 401);
});

test("P3-1-2 viewer 调 receive_lot 应 403", () => {
  const { req, res, getResult } = mkReqRes({ material_id: 1, lot_no: "L-VW-" + Date.now(), quantity: 10 }, { user: { uid: 2, role: "viewer" } });
  ctx.routes['POST /api/material_lots/receive'].handler(req, res);
  assert.equal(getResult().status, 403);
});

test("P3-1-3 warehouse 调 receive_lot 应 200", () => {
  const { req, res, getResult } = mkReqRes({ material_id: 1, lot_no: "L-WH-" + Date.now(), quantity: 10, location: "A" }, { user: { uid: 3, role: "warehouse" } });
  ctx.routes['POST /api/material_lots/receive'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 200, "status=" + r.status + " err=" + JSON.stringify(r.json));
});

test("P3-1-4 worker 调 allocate 应 403", () => {
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 10 }, { user: { uid: 4, role: "worker" } });
  ctx.routes['POST /api/inventory/allocate'].handler(req, res);
  assert.equal(getResult().status, 403);
});

test("P3-1-5 planner 调 allocate 应 200", () => {
  _db.prepare("INSERT OR IGNORE INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 10 }, { user: { uid: 5, role: "planner" } });
  ctx.routes['POST /api/inventory/allocate'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 200, "status=" + r.status + " err=" + JSON.stringify(r.json));
});

// ---------------- P3-2 ----------------

test("P3-2-1 movements 默认 limit 50", () => {
  for (let i = 0; i < 60; i++) _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, created_at) VALUES (1, 'receive', 1, '2026-01-15')").run();
  const { req, res, getResult } = mkReqRes({});
  ctx.routes["GET /api/material_movements"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.limit, 50);
  assert.equal(r.offset, 0);
  assert.equal(r.count, 50);
  assert.ok(r.total >= 60);
  assert.equal(r.items.length, 50);
});

test("P3-2-2 movements 自定义 limit offset", () => {
  const { req, res, getResult } = mkReqRes({}, { query: { limit: "10", offset: "20" } });
  ctx.routes["GET /api/material_movements"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.limit, 10);
  assert.equal(r.offset, 20);
  assert.ok(r.items.length <= 10);
});

test("P3-2-3 movements 过滤 movement_type", () => {
  for (let i = 0; i < 3; i++) _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, created_at) VALUES (1, 'issue', 5, '2026-02-15')").run();
  const { req, res, getResult } = mkReqRes({}, { query: { movement_type: "issue" } });
  ctx.routes["GET /api/material_movements"].handler(req, res);
  const r = getResult().json;
  assert.ok(r.items.length >= 3);
  assert.ok(r.items.every(m => m.movement_type === "issue"));
});

test("P3-2-4 movements 日期范围过滤", () => {
  const { req, res, getResult } = mkReqRes({}, { query: { date_from: "2026-02-01", date_to: "2026-02-28" } });
  ctx.routes["GET /api/material_movements"].handler(req, res);
  const r = getResult().json;
  assert.ok(r.items.every(m => m.created_at >= "2026-02-01" && m.created_at <= "2026-02-28 23:59:59"));
});

test("P3-2-5 movements limit 上限 500", () => {
  const { req, res, getResult } = mkReqRes({}, { query: { limit: "10000" } });
  ctx.routes["GET /api/material_movements"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.limit, 500, "limit 10000 应截到 500");
});


// ---------------- P3-3 batch ----------------

test("P3-3-1 batch 非原子: 3 条都成功", () => {
  const movements = [
    { material_lot_id: 1, movement_type: "receive", quantity: 10, to_location: "A" },
    { material_lot_id: 1, movement_type: "receive", quantity: 20, to_location: "B" },
    { material_lot_id: 1, movement_type: "issue", quantity: 5, from_location: "A" },
  ];
  const { req, res, getResult } = mkReqRes({ movements, atomic: false });
  ctx.routes["POST /api/material_movements/batch"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.success, true);
  assert.equal(r.atomic, false);
  assert.equal(r.count, 3);
  assert.equal(r.failed.length, 0);
  assert.equal(r.ids.length, 3);
  // 验证库存
  const a = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND location='A'").get();
  assert.equal(a.quantity, 5);
  const b = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND location='B'").get();
  assert.equal(b.quantity, 20);
});

test("P3-3-2 batch 非原子: 部分失败", () => {
  const movements = [
    { material_lot_id: 1, movement_type: "receive", quantity: 5, to_location: "C" },
    { material_lot_id: 1, movement_type: "issue", quantity: 999, from_location: "C" }, // 库存不足
  ];
  const { req, res, getResult } = mkReqRes({ movements, atomic: false });
  ctx.routes["POST /api/material_movements/batch"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.success, false);
  assert.equal(r.count, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].index, 1);
  assert.match(r.failed[0].error, /库存不足/);
});

test("P3-3-3 batch 原子: 第 2 条失败则全部回滚", () => {
  // 先入库
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'D', 50)").run();
  const movements = [
    { material_lot_id: 1, movement_type: "issue", quantity: 10, from_location: "D" },
    { material_lot_id: 1, movement_type: "issue", quantity: 999, from_location: "D" }, // 失败
    { material_lot_id: 1, movement_type: "issue", quantity: 5, from_location: "D" },
  ];
  const { req, res, getResult } = mkReqRes({ movements, atomic: true });
  ctx.routes["POST /api/material_movements/batch"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.success, false);
  assert.equal(r.atomic, true);
  assert.match(r.error, /库存不足/);
  // 验证库存回滚
  const d = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND location='D'").get();
  assert.equal(d.quantity, 50, "原子失败后库存应未变");
});

test("P3-3-4 batch 空数组应 400", () => {
  const { req, res, getResult } = mkReqRes({ movements: [], atomic: true });
  ctx.routes["POST /api/material_movements/batch"].handler(req, res);
  assert.equal(getResult().status, 400);
});


// ---------------- P3-4 GET /:id ----------------

test("P3-4-1 GET /api/material_lots/:id 存在", () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'A', 50), (1, 'B', 30)").run();
  _db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity) VALUES (1, 'receive', 80), (1, 'issue', 10), (1, 'issue', 5)").run();
  const { req, res, getResult } = mkReqRes({}, { params: { id: "1" } });
  ctx.routes["GET /api/material_lots/:id"].handler(req, res);
  const r = getResult().json;
  assert.equal(r.id, 1);
  assert.equal(r.lot_no, "LOT-001");
  assert.equal(r.material_name, "测试物料");
  assert.equal(r.inventory_total, 80);
  assert.equal(r.inventory.length, 2);
  assert.equal(r.movement_stats.receive.qty, 80);
  assert.equal(r.movement_stats.issue.cnt, 2);
});

test("P3-4-2 GET /api/material_lots/:id 不存在 404", () => {
  const { req, res, getResult } = mkReqRes({}, { params: { id: "999" } });
  ctx.routes["GET /api/material_lots/:id"].handler(req, res);
  assert.equal(getResult().status, 404);
});

test("P3-4-3 GET /api/material_lots/:id 非数字 400", () => {
  const { req, res, getResult } = mkReqRes({}, { params: { id: "abc" } });
  ctx.routes["GET /api/material_lots/:id"].handler(req, res);
  assert.equal(getResult().status, 400);
});

test("P3-4-4 GET /api/material_lots/:id 未登录 401", () => {
  const { req, res, getResult } = mkReqRes({}, { params: { id: "1" }, user: undefined });
  ctx.routes["GET /api/material_lots/:id"].handler(req, res);
  assert.equal(getResult().status, 401);
});


// ---------------- P3-5 split ----------------

test("P3-5-1 split: 从 lot 1 拆 30 到新 lot", () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'A', 100)").run();
  const { req, res, getResult } = mkReqRes({ quantity: 30, new_lot_no: "LOT-001-S1", location: "A" }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/split"].handler(req, res);
  const r = getResult().json;
  assert.equal(getResult().status, 200);
  assert.equal(r.new_lot_no, "LOT-001-S1");
  assert.equal(r.quantity, 30);
  const src = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND location='A'").get();
  assert.equal(src.quantity, 70);
  const newLot = _db.prepare("SELECT * FROM material_lots WHERE lot_no='LOT-001-S1'").get();
  assert.equal(newLot.quantity, 30);
  const newInv = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=? AND location='A'").get(newLot.id);
  assert.equal(newInv.quantity, 30);
});

test("P3-5-2 split 库存不足应 400", () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'A', 10)").run();
  const { req, res, getResult } = mkReqRes({ quantity: 50, new_lot_no: "LOT-001-S2" }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/split"].handler(req, res);
  assert.equal(getResult().status, 400);
});

test("P3-5-3 split new_lot_no 重复应 400", () => {
  const { req, res, getResult } = mkReqRes({ quantity: 10, new_lot_no: "LOT-001" }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/split"].handler(req, res);
  assert.equal(getResult().status, 400);
});

// ---------------- P3-6 merge ----------------

test("P3-6-1 merge: 2 个源 lot 合并到目标 lot", () => {
  // 准备: lot 1 (id=1) 已有 100, 新建 lot 2, 3 各 50
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (2, 1, 'LOT-002', 50)").run();
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (3, 1, 'LOT-003', 50)").run();
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'A', 100), (2, 'A', 50), (3, 'A', 50)").run();
  const { req, res, getResult } = mkReqRes({ source_lot_ids: [2, 3], location: "A" }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/merge"].handler(req, res);
  const r = getResult().json;
  assert.equal(getResult().status, 200);
  assert.equal(r.merged.length, 2);
  const dst = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND location='A'").get();
  assert.equal(dst.quantity, 200, "目标 lot 库存 = 100 + 50 + 50");
  const s2 = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=2 AND location='A'").get();
  assert.equal(s2.quantity, 0, "源 lot 2 库存归零");
});

test("P3-6-2 merge 物料不同应 400", () => {
  _db.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (2, 'T-002', '另物料')").run();
  _db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (4, 2, 'LOT-004', 10)").run();
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity) VALUES (4, 'A', 10)").run();
  const { req, res, getResult } = mkReqRes({ source_lot_ids: [4], location: "A" }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/merge"].handler(req, res);
  assert.equal(getResult().status, 400);
});

test("P3-6-3 merge 自己合自己应 400", () => {
  const { req, res, getResult } = mkReqRes({ source_lot_ids: [1] }, { params: { id: "1" } });
  ctx.routes["POST /api/material_lots/:id/merge"].handler(req, res);
  assert.equal(getResult().status, 400);
});
