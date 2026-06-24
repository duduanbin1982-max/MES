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
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  return db;
}

function makeApp(db) {
  const fakePath = path.resolve(__dirname, '../db');
  require.cache[fakePath] = { exports: db, loaded: true, id: fakePath, filename: fakePath, children: [], paths: [] };
  const svc = require('../services/materialService');
  const routes = {};
  const app = {
    get: (p, h) => { routes[p] = { method: 'get', handler: h }; },
    post: (p, h) => { routes[p] = { method: 'post', handler: h }; },
    put: (p, h) => { routes[p] = { method: 'put', handler: h }; },
    patch: (p, h) => { routes[p] = { method: 'patch', handler: h }; },
    delete: (p, h) => { routes[p] = { method: 'delete', handler: h }; },
  };
  svc.register(app, db);
  return { app, routes };
}

function mkReqRes(body) {
  const req = { body, query: {}, params: {} };
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
  ctx.routes['/api/material_movements'].handler(req, res);
  const { status, json } = getResult();
  assert.equal(status, 200, 'expect 200');
  assert.ok(json.id, 'movement id 应返回');
  const inv = _db.prepare('SELECT * FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 100, 'inventory 应新增 100');
  assert.equal(inv.status, 'available');
});

test('P0-2-2 issue: 在 receive 后 issue 30, 库存剩 70', () => {
  let { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'receive', quantity: 100, to_location: '主仓库-A-01', unit: 'pcs' });
  ctx.routes['/api/material_movements'].handler(req, res);
  ({ req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'issue', quantity: 30, from_location: '主仓库-A-01', work_order_id: 1 }));
  ctx.routes['/api/material_movements'].handler(req, res);
  const inv = _db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 70, 'issue 后剩 70');
});

test('P0-2-3 issue-overflow: 库存不足返回 400, 事务回滚', () => {
  let { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'receive', quantity: 10, to_location: '主仓库-A-01' });
  ctx.routes['/api/material_movements'].handler(req, res);
  ({ req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'issue', quantity: 50, from_location: '主仓库-A-01' }));
  ctx.routes['/api/material_movements'].handler(req, res);
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
  ctx.routes['/api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare('SELECT quantity FROM inventory WHERE location = ?').get('A');
  const b = _db.prepare('SELECT quantity FROM inventory WHERE location = ?').get('B');
  assert.equal(a.quantity, 20, 'A 剩 20');
  assert.equal(b.quantity, 30, 'B 增 30');
});

test('P0-2-5 adjust: 盘点把 100 改成 80', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'adjust', quantity: 80, to_location: 'A' });
  ctx.routes['/api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const inv = _db.prepare('SELECT quantity, status FROM inventory WHERE location = ?').get('A');
  assert.equal(inv.quantity, 80, 'adjust 后 = 80');
  assert.equal(inv.status, 'available', 'adjust 后 status 仍 available');
});

test('P0-2-6 return: 退料同 receive, 库存 +5', () => {
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, movement_type: 'return', quantity: 5, to_location: '主仓库-A-01' });
  ctx.routes['/api/material_movements'].handler(req, res);
  assert.equal(getResult().status, 200);
  const inv = _db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1 AND location = ?').get('主仓库-A-01');
  assert.equal(inv.quantity, 5, 'return 后 = 5');
});
test('P1-5-1 allocate: 100 available -> 70 available + 30 allocated', () => {
  // 准备: 100 available
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 100, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 30, location: 'A' });
  ctx.routes['/api/inventory/allocate'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='available'").get();
  const b = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='allocated'").get();
  assert.equal(a.quantity, 70);
  assert.equal(b.quantity, 30);
});

test('P1-5-2 allocate 超量应 400 + 事务回滚', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 10, 'available')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 50 });
  ctx.routes['/api/inventory/allocate'].handler(req, res);
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
  ctx.routes['/api/inventory/release'].handler(req, res);
  assert.equal(getResult().status, 200);
  const a = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='available'").get();
  const b = _db.prepare("SELECT quantity FROM inventory WHERE material_lot_id=1 AND status='allocated'").get();
  assert.equal(a.quantity, 130, 'release 后 available 应 +30');
  assert.equal(b.quantity, 0, 'allocated 应归 0');
});

test('P1-5-4 release 超量应 400', () => {
  _db.prepare("INSERT INTO inventory (material_lot_id, location, quantity, status) VALUES (1, 'A', 5, 'allocated')").run();
  const { req, res, getResult } = mkReqRes({ material_lot_id: 1, work_order_id: 1, quantity: 50 });
  ctx.routes['/api/inventory/release'].handler(req, res);
  const r = getResult();
  assert.equal(r.status, 400);
  assert.match(r.json.error, /不足/);
});