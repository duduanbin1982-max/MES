'use strict';

/**
 * materialChain.test.js
 * 2026-11-05 物料链路深挖（BOM 需求 → 领料 → 库存扣减 → 批次追溯）整改验证：
 *   1) 领料扣减库存 + 写 issue 流水（lot / 工单 / 操作人）
 *   2) allow_over_pick 仅主管可用（非主管不能绕过剩余需求）
 *   3) 库存不足拒绝且不扣减
 *   4) 来料检验不合格批次禁止领用
 *   5) 退料恢复库存 + return 流水 + 超退拦截
 *   6) 退料按批次质量状态回写（failed/pending → quarantined，passed → available）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT UNIQUE, equipment_instance_id INTEGER, status TEXT DEFAULT 'in_progress', quantity_planned INTEGER DEFAULT 1, quantity_completed INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, spec TEXT, unit TEXT DEFAULT '件')`);
  db.exec(`CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT UNIQUE NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT DEFAULT 'pending', notes TEXT)`);
  db.exec(`CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT 'available', last_updated TEXT)`);
  db.exec(`CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`CREATE TABLE instance_bom (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, unit TEXT, scrap_factor REAL DEFAULT 1, tier INTEGER, part_number TEXT, category TEXT, storage_location TEXT, is_phantom INTEGER DEFAULT 0, is_alternative INTEGER DEFAULT 0)`);
  return db;
}

function makeRoutes(db) {
  const { registerPickRoutes } = require('../services/pick/routes');
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
  };
  registerPickRoutes(app, db);
  return routes;
}

function call(routes, method, path, body, user) {
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query: {}, params, user: user || { sub: 9, role: 'admin' } };
  let status = 200;
  let json = null;
  const res = {
    status: (code) => { status = code; return res; },
    json: (payload) => { json = payload; return res; },
  };
  handler(req, res, (error) => {
    if (!error) return;
    status = error.status || 500;
    json = { error: error.message, code: error.code || 'INTERNAL_ERROR' };
  });
  return { status, json };
}

let db;
let routes;
test.beforeEach(() => {
  db = freshDb();
  db.prepare(`INSERT INTO work_orders (id, wo_code, equipment_instance_id) VALUES (1, 'WO-MAT-001', 1)`).run();
  db.prepare(`INSERT INTO materials (id, material_code, material_name) VALUES (101, 'M-101', '钢板')`).run();
  db.prepare(`INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, quality_status) VALUES (1, 101, 'LOT-OK', 100, 'kg', 'passed')`).run();
  db.prepare(`INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (1, '主仓库-A-01', 100, 'kg', 'available')`).run();
  routes = makeRoutes(db);
});

function inventoryQty() {
  return db.prepare(`SELECT quantity FROM inventory WHERE material_lot_id = 1`).get().quantity;
}

test('MC.1 领料扣减库存并写 issue 流水（批次/工单/操作人）', () => {
  const result = call(routes, 'POST', '/api/work_orders/:id/pick', {
    __id: 1,
    items: [{ material_id: 101, quantity: 30, lot_id: 1 }],
    allow_over_pick: true,
    operator_id: 9,
  }, { sub: 9, role: 'admin' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.picked, 1);
  assert.equal(inventoryQty(), 70);
  const movement = db.prepare(`SELECT * FROM material_movements WHERE movement_type = 'issue'`).get();
  assert.equal(movement.material_lot_id, 1);
  assert.equal(movement.work_order_id, 1);
  assert.equal(movement.operator_id, 9);
  assert.equal(movement.quantity, 30);
});

test('MC.2 非主管传 allow_over_pick 不能绕过剩余需求（剩余 0 时拒绝）', () => {
  const result = call(routes, 'POST', '/api/work_orders/:id/pick', {
    __id: 1,
    items: [{ material_id: 101, quantity: 10, lot_id: 1 }],
    allow_over_pick: true,
  }, { sub: 9, role: 'worker' });
  assert.equal(result.status, 200);
  assert.equal(result.json.picked, 0);
  assert.match(result.json.errors_detail[0].error, /剩余/);
  assert.equal(inventoryQty(), 100, '被拒后库存不变');
});

test('MC.3 库存不足拒绝且不扣减', () => {
  db.prepare(`UPDATE inventory SET quantity = 5 WHERE material_lot_id = 1`).run();
  const result = call(routes, 'POST', '/api/work_orders/:id/pick', {
    __id: 1,
    items: [{ material_id: 101, quantity: 10, lot_id: 1 }],
    allow_over_pick: true,
  }, { sub: 9, role: 'admin' });
  assert.equal(result.json.picked, 0);
  assert.match(result.json.errors_detail[0].error, /库存不足/);
  assert.equal(inventoryQty(), 5);
});

test('MC.4 来料检验不合格批次禁止领用', () => {
  db.prepare(`UPDATE material_lots SET quality_status = 'failed' WHERE id = 1`).run();
  const result = call(routes, 'POST', '/api/work_orders/:id/pick', {
    __id: 1,
    items: [{ material_id: 101, quantity: 10, lot_id: 1 }],
    allow_over_pick: true,
  }, { sub: 9, role: 'admin' });
  assert.equal(result.json.picked, 0);
  assert.match(result.json.errors_detail[0].error, /来料检验不合格/);
  assert.equal(inventoryQty(), 100);
});

test('MC.5 退料恢复库存 + return 流水；非主管超退被拒', () => {
  call(routes, 'POST', '/api/work_orders/:id/pick', { __id: 1, items: [{ material_id: 101, quantity: 30, lot_id: 1 }], allow_over_pick: true }, { sub: 9, role: 'admin' });
  let result = call(routes, 'POST', '/api/work_orders/:id/return', { __id: 1, items: [{ lot_id: 1, quantity: 10 }] }, { sub: 9, role: 'admin' });
  assert.equal(result.json.returned, 1);
  assert.equal(inventoryQty(), 80);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM material_movements WHERE movement_type = 'return'`).get().c, 1);
  result = call(routes, 'POST', '/api/work_orders/:id/return', { __id: 1, items: [{ lot_id: 1, quantity: 999, reason: '超退' }], allow_over_return: true }, { sub: 9, role: 'worker' });
  assert.equal(result.json.returned, 0);
  assert.match(result.json.errors_detail[0].error, /超过可退数量/);
});

test('MC.6 退料按批次质量状态回写：failed → quarantined，passed → available', () => {
  call(routes, 'POST', '/api/work_orders/:id/pick', { __id: 1, items: [{ material_id: 101, quantity: 30, lot_id: 1 }], allow_over_pick: true }, { sub: 9, role: 'admin' });
  db.prepare(`UPDATE material_lots SET quality_status = 'failed' WHERE id = 1`).run();
  call(routes, 'POST', '/api/work_orders/:id/return', { __id: 1, items: [{ lot_id: 1, quantity: 10 }] }, { sub: 9, role: 'admin' });
  assert.equal(db.prepare(`SELECT status FROM inventory WHERE material_lot_id = 1`).get().status, 'quarantined', '不合格批次退料后应保持隔离');
  db.prepare(`UPDATE material_lots SET quality_status = 'passed' WHERE id = 1`).run();
  call(routes, 'POST', '/api/work_orders/:id/return', { __id: 1, items: [{ lot_id: 1, quantity: 5 }] }, { sub: 9, role: 'admin' });
  assert.equal(db.prepare(`SELECT status FROM inventory WHERE material_lot_id = 1`).get().status, 'available');
});
