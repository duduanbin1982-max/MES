'use strict';

/**
 * purchase.test.js
 * P1-#4 验: 采购订单完整链路 (供应商 + PO 创建 + 状态机 + 收货)
 * 6 个用例, in-memory DB
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_code TEXT UNIQUE NOT NULL, supplier_name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, address TEXT, payment_terms TEXT, rating TEXT DEFAULT "B", is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT "2026-01-01 00:00:00", updated_at TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)');
  db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, spec TEXT, unit TEXT DEFAULT "pcs", safety_stock REAL DEFAULT 0)');
  db.exec('CREATE TABLE key_components (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, component_type TEXT, supplier TEXT, lead_time_weeks INTEGER, unit_price REAL, risk_level TEXT DEFAULT "medium", notes TEXT)');
  db.exec('CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER NOT NULL, actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT, currency TEXT NOT NULL DEFAULT "CNY", valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT, priced_by INTEGER, priced_at TEXT NOT NULL)');
  db.exec('CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT UNIQUE NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT DEFAULT "2026-01-01 00:00:00", quantity REAL, unit TEXT, quality_status TEXT DEFAULT "pending", notes TEXT)');
  db.exec('CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT "available", last_updated TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT UNIQUE NOT NULL, supplier_id INTEGER NOT NULL, equipment_instance_id INTEGER, status TEXT NOT NULL DEFAULT "draft", ordered_date TEXT, expected_date TEXT, subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total_amount REAL DEFAULT 0, currency TEXT DEFAULT "CNY", payment_terms TEXT, created_by INTEGER, approved_by INTEGER, approved_at TEXT, closed_at TEXT, notes TEXT, created_at TEXT DEFAULT "2026-01-01 00:00:00", updated_at TEXT DEFAULT "2026-01-01 00:00:00")');
  db.exec('CREATE TABLE po_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL, material_id INTEGER NOT NULL, quantity REAL NOT NULL, unit TEXT, unit_price REAL NOT NULL, line_amount REAL NOT NULL, expected_date TEXT, received_qty REAL DEFAULT 0, lot_no_at_receipt TEXT, notes TEXT, line_no INTEGER NOT NULL, created_at TEXT DEFAULT "2026-01-01 00:00:00")');
  return db;
}

function makeApp(db) {
  const fakePath = path.resolve(__dirname, '../db');
  require.cache[fakePath] = { exports: db, loaded: true, id: fakePath, filename: fakePath, children: [], paths: [] };
  const svc = require('../services/purchase');
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
    put: (p, h) => { routes['PUT ' + p] = h; },
    patch: (p, h) => { routes['PATCH ' + p] = h; },
    delete: (p, h) => { routes['DELETE ' + p] = h; },
  };
  svc.register(app, db);
  return routes;
}

function call(routes, method, path, body) {
  const key = method + ' ' + path;
  const handler = routes[key];
  if (!handler) throw new Error('no route: ' + key);
  const req = { body: body || {}, query: {}, params: {} };
  // 简化: 把 path 中的 :id 解到 req.params
  const m = path.match(/:([^/]+)/g);
  if (m) {
    m.forEach((tok, i) => { req.params[tok.slice(1)] = body && body['__id_' + i] !== undefined ? body['__id_' + i] : '1'; });
    // 实际测试里直接给 body.__id 字段
  }
  let status = 200, json = null;
  const res = {
    status: (s) => { status = s; return res; },
    json: (j) => { json = j; return res; },
  };
  const next = (err) => {
    if (!err) return;
    status = err.status || 500;
    json = { error: err.message, code: err.code || 'INTERNAL_ERROR', details: err.details || null };
  };
  handler(req, res, next);
  return { status, json };
}

let _db, routes;
test.beforeEach(() => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/db') && !k.includes('better-sqlite3') && !k.includes('node_modules')) {
      delete require.cache[k];
    }
  }
  _db = freshDb();
  _db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (?, ?, ?)').run(101, 'M-T-1', '测试物料A');
  _db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (?, ?, ?)').run(102, 'M-T-2', '测试物料B');
  _db.prepare('INSERT INTO key_components (id, material_id, component_type) VALUES (?, ?, ?)').run(1, 101, 'main_bearing');
  routes = makeApp(_db);
});

test('P1-4-1 POST /api/suppliers 创供应商 + 唯一性校验', () => {
  let r = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-001', supplier_name: '上海重工' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(r.json.id, '应返回 id');
  // 重复 supplier_code 应 400
  r = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-001', supplier_name: '上海重工2' });
  assert.equal(r.status, 400, '重复应 400');
});

test('P1-4-2 POST /api/purchase_orders 创 PO (2 行) + 算 subtotal', () => {
  // 先建供应商
  const supR = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-002', supplier_name: '北方钢铁' });
  const supId = supR.json.id;
  // 创 PO
  const r = call(routes, 'POST', '/api/purchase_orders', {
    supplier_id: supId,
    expected_date: '2026-08-01',
    lines: [
      { material_id: 101, quantity: 5, unit: 'pcs', unit_price: 380 },
      { material_id: 102, quantity: 10, unit: 'pcs', unit_price: 100 },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.json.po_no.startsWith('PO-'), true, 'po_no 应 PO- 开头');
  assert.equal(r.json.subtotal, 5 * 380 + 10 * 100, 'subtotal = 1900 + 1000 = 2900');
  assert.equal(r.json.total_amount, 2900);
  // 验证 DB 里 line_no 1 和 2
  const lines = _db.prepare('SELECT line_no, quantity, unit_price, line_amount FROM po_lines WHERE po_id = ? ORDER BY line_no').all(r.json.id);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].line_no, 1);
  assert.equal(lines[0].line_amount, 1900);
  assert.equal(lines[1].line_amount, 1000);
});

test('P1-4-3 PATCH /api/purchase_orders/:id/status 状态机 + 错误 status 拒绝', () => {
  const supR = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-003', supplier_name: 'S3' });
  const supId = supR.json.id;
  const po = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supId, lines: [{ material_id: 101, quantity: 1, unit_price: 100 }] });
  // draft -> submitted OK
  let r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id_0: po.json.id });
  assert.equal(r.status, 200);
  // submitted -> confirmed OK
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed' });
  assert.equal(r.status, 200);
  // 非法状态应 400
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'weird_state' });
  assert.equal(r.status, 400);
});

test('P1-4-4 POST /api/purchase_orders/:id/receive 部分收货 -> partially_received', () => {
  const supR = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-004', supplier_name: 'S4' });
  const supId = supR.json.id;
  const po = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supId, lines: [{ material_id: 101, quantity: 10, unit_price: 380 }] });
  // 先 confirmed
  call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed' });
  // 部分收 6
  const lines = _db.prepare('SELECT id FROM po_lines WHERE po_id = ?').all(po.json.id);
  const r = call(routes, 'POST', '/api/purchase_orders/:id/receive', {
    lines: [{ line_id: lines[0].id, received_qty: 6, lot_no: 'LOT-PO-1', location: '主仓' }],
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.json.po_status, 'partially_received');
  assert.equal(r.json.created_lots[0].received_qty, 6);
  // 库存应 +6
  const inv = _db.prepare('SELECT i.quantity FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id WHERE ml.lot_no = ?').get('LOT-PO-1');
  assert.equal(inv.quantity, 6);
  // key_component_prices 应被写
  const kcp = _db.prepare('SELECT actual_price, vendor_po FROM key_component_prices').all();
  assert.equal(kcp.length, 1, '关键件应写 1 行 price');
  assert.equal(kcp[0].actual_price, 380);
  assert.equal(kcp[0].vendor_po.startsWith('PO-'), true);
});

test('P1-4-5 POST /api/purchase_orders/:id/receive 全收 -> received', () => {
  const supR = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-005', supplier_name: 'S5' });
  const supId = supR.json.id;
  const po = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supId, lines: [{ material_id: 101, quantity: 5, unit_price: 380 }] });
  call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed' });
  const lines = _db.prepare('SELECT id FROM po_lines WHERE po_id = ?').all(po.json.id);
  const r = call(routes, 'POST', '/api/purchase_orders/:id/receive', {
    lines: [{ line_id: lines[0].id, received_qty: 5, lot_no: 'LOT-PO-2' }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.po_status, 'received');
});

test('P1-4-6 POST /api/purchase_orders/:id/receive 超量应 400 + 事务回滚', () => {
  const supR = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-006', supplier_name: 'S6' });
  const supId = supR.json.id;
  const po = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supId, lines: [{ material_id: 101, quantity: 5, unit_price: 380 }] });
  call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed' });
  const lines = _db.prepare('SELECT id FROM po_lines WHERE po_id = ?').all(po.json.id);
  const r = call(routes, 'POST', '/api/purchase_orders/:id/receive', {
    lines: [{ line_id: lines[0].id, received_qty: 10, lot_no: 'LOT-PO-3' }],  // 超量
  });
  assert.equal(r.status, 400, '超量应 400');
  assert.match(r.json.error, /超量/);
  // 库存应没创建 (事务回滚)
  const inv = _db.prepare("SELECT COUNT(*) AS c FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id WHERE ml.lot_no = 'LOT-PO-3'").get();
  assert.equal(inv.c, 0, '事务回滚, 库存行不应存在');
});