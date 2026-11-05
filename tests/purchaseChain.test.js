'use strict';

/**
 * purchaseChain.test.js
 * 2026-11-05 采购链路深挖（P1 整改验证）：
 *   1) 状态机合法流转 / 收货状态不可手工设置 / 审批人要求与职责分离
 *   2) 收货把供应商写入批次（修复恒为 null）
 *   3) 创建校验（物料存在 / 数量 > 0 / 单价 >= 0）
 *   4) 对账：发票录入 + 对账汇总（已订/已收/已开票/差异）+ 发票状态流转
 *   5) 详情返回收货历史
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1)');
  db.exec('CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_code TEXT UNIQUE NOT NULL, supplier_name TEXT NOT NULL, contact_person TEXT, phone TEXT, is_active INTEGER DEFAULT 1)');
  db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, unit TEXT DEFAULT "pcs")');
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)');
  db.exec('CREATE TABLE key_components (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, component_type TEXT, unit_price REAL)');
  db.exec('CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER NOT NULL, actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT, currency TEXT DEFAULT "CNY", valid_from TEXT, notes TEXT, priced_at TEXT)');
  db.exec('CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT UNIQUE NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT DEFAULT "pending", notes TEXT)');
  db.exec('CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT "available", last_updated TEXT)');
  db.exec('CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.exec('CREATE TABLE purchase_receiving (id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER, po_item_id INTEGER, received_qty REAL, quality_status TEXT DEFAULT "pending", inspected_by INTEGER, lot_no TEXT, warehouse_location TEXT, received_at TEXT, notes TEXT)');
  db.exec('CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT UNIQUE NOT NULL, supplier_id INTEGER NOT NULL, equipment_instance_id INTEGER, status TEXT NOT NULL DEFAULT "draft", ordered_date TEXT, expected_date TEXT, subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total_amount REAL DEFAULT 0, currency TEXT DEFAULT "CNY", payment_terms TEXT, created_by INTEGER, approved_by INTEGER, approved_at TEXT, closed_at TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)');
  db.exec('CREATE TABLE po_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL, material_id INTEGER NOT NULL, quantity REAL NOT NULL, unit TEXT, unit_price REAL NOT NULL, line_amount REAL NOT NULL, expected_date TEXT, received_qty REAL DEFAULT 0, lot_no_at_receipt TEXT, notes TEXT, line_no INTEGER NOT NULL)');
  return db;
}

function makeRoutes(db) {
  const { register } = require('../services/purchase');
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
    put: (p, h) => { routes['PUT ' + p] = h; },
    patch: (p, h) => { routes['PATCH ' + p] = h; },
    delete: (p, h) => { routes['DELETE ' + p] = h; },
  };
  register(app, db);
  return routes;
}

let seq = 1;
function call(routes, method, path, body) {
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length === 1) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query: {}, params };
  let status = 200;
  let json = null;
  const res = {
    status: (code) => { status = code; return res; },
    json: (payload) => { json = payload; return res; },
  };
  handler(req, res, (error) => {
    if (!error) return;
    status = error.status || 500;
    json = { error: error.message, code: error.code || 'INTERNAL_ERROR', details: error.details || null };
  });
  return { status, json };
}

function makeSupplier() {
  const code = 'SUP-' + seq++;
  const result = db.prepare('INSERT INTO suppliers (supplier_code, supplier_name) VALUES (?, ?)').run(code, '供应商' + code);
  return Number(result.lastInsertRowid);
}

function createPo(routes, quantity = 10, unitPrice = 100) {
  const supplierId = makeSupplier();
  const po = call(routes, 'POST', '/api/purchase_orders', {
    supplier_id: supplierId,
    created_by: 1,
    lines: [{ material_id: 101, quantity, unit_price: unitPrice }],
  });
  assert.equal(po.status, 200, JSON.stringify(po.json));
  return po.json;
}

function confirmPo(routes, poId, approvedBy = 2) {
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id: poId }).status, 200);
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed', approved_by: approvedBy, __id: poId }).status, 200);
}

let db;
let routes;
test.beforeEach(() => {
  db = freshDb();
  db.prepare('INSERT INTO users (id, username, full_name, role) VALUES (?, ?, ?, ?)').run(1, 'creator', '创建人', 'planner');
  db.prepare('INSERT INTO users (id, username, full_name, role) VALUES (?, ?, ?, ?)').run(2, 'approver', '审批人', 'admin');
  db.prepare('INSERT INTO materials (id, material_code, material_name, unit) VALUES (?, ?, ?, ?)').run(101, 'M-101', '钢板', 'kg');
  routes = makeRoutes(db);
});

test('PC.1 状态机：draft→in_transit 拒绝；received/partially_received 不能手工设置', () => {
  const po = createPo(routes);
  let r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'in_transit', __id: po.id });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /不能从/);
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'received', __id: po.id });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /只能由收货接口推进/);
  // draft → submitted → confirmed（带审批人）
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id: po.id }).status, 200);
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed', __id: po.id });
  assert.equal(r.status, 400, '没有 approved_by 不允许确认');
});

test('PC.2 职责分离：审批人不能等于创建人', () => {
  const po = createPo(routes);
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id: po.id }).status, 200);
  const r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed', approved_by: 1, __id: po.id });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /职责分离/);
});

test('PC.3 创建校验：物料不存在 404、数量 0 与负单价 400', () => {
  const supplierId = makeSupplier();
  let r = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supplierId, lines: [{ material_id: 999, quantity: 1, unit_price: 1 }] });
  assert.equal(r.status, 404);
  r = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supplierId, lines: [{ material_id: 101, quantity: 0, unit_price: 1 }] });
  assert.equal(r.status, 400);
  r = call(routes, 'POST', '/api/purchase_orders', { supplier_id: supplierId, lines: [{ material_id: 101, quantity: 1, unit_price: -1 }] });
  assert.equal(r.status, 400);
});

test('PC.4 完整链路：创建→提交→审批→部分收货→全收→发票→对账→关闭', () => {
  const po = createPo(routes, 10, 100);
  confirmPo(routes, po.id);
  const lineId = db.prepare('SELECT id FROM po_lines WHERE po_id = ?').get(po.id).id;

  // 部分收货 4
  let r = call(routes, 'POST', '/api/purchase_orders/:id/receive', { __id: po.id, lines: [{ line_id: lineId, received_qty: 4, lot_no: 'LOT-A' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.po_status, 'partially_received');
  const lot = db.prepare('SELECT * FROM material_lots WHERE lot_no = ?').get('LOT-A');
  const supplierName = db.prepare('SELECT s.supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?').get(po.id).supplier_name
  assert.equal(lot.supplier, supplierName, '批次应记录供应商名（修复恒 null）');
  const inv = db.prepare('SELECT * FROM inventory WHERE material_lot_id = ?').get(lot.id);
  assert.equal(inv.status, 'quarantined');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_movements WHERE movement_type = ?').get('receive').c, 1);

  // 全收剩余 6
  r = call(routes, 'POST', '/api/purchase_orders/:id/receive', { __id: po.id, lines: [{ line_id: lineId, received_qty: 6, lot_no: 'LOT-B' }] });
  assert.equal(r.status, 200);
  assert.equal(r.json.po_status, 'received');

  // 详情包含收货历史与对账汇总
  const detail = call(routes, 'GET', '/api/purchase_orders/:id', { __id: po.id });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.receiving_history.length, 2);
  assert.equal(detail.json.reconciliation.status, 'pending');
  assert.equal(detail.json.reconciliation.received_amount, 1000);

  // 录发票（先录 1000 匹配）
  r = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-001', amount: 1000, tax_amount: 130 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const invoiceId = r.json.id;
  const recon = call(routes, 'GET', '/api/purchase_orders/:id/reconciliation', { __id: po.id });
  assert.equal(recon.status, 200);
  assert.equal(recon.json.summary.status, 'matched');
  assert.equal(recon.json.summary.ordered_amount, 1000);
  assert.equal(recon.json.summary.received_amount, 1000);
  assert.equal(recon.json.summary.invoiced_amount, 1000);
  assert.equal(recon.json.summary.variance, 0);
  assert.equal(recon.json.summary.fully_received, true);

  // 发票状态：pending → paid 拒绝（必须先 matched）
  r = call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: invoiceId, status: 'paid' });
  assert.equal(r.status, 400);
  r = call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: invoiceId, status: 'matched' });
  assert.equal(r.status, 200);
  r = call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: invoiceId, status: 'paid' });
  assert.equal(r.status, 200);

  // 关闭
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'closed', __id: po.id });
  assert.equal(r.status, 200);
  r = call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'draft', __id: po.id });
  assert.equal(r.status, 400, 'closed 为终态');
});

test('PC.5 对账差异：发票金额 > 收货金额 → variance + 差额', () => {
  const po = createPo(routes, 5, 100);
  confirmPo(routes, po.id);
  const lineId = db.prepare('SELECT id FROM po_lines WHERE po_id = ?').get(po.id).id;
  call(routes, 'POST', '/api/purchase_orders/:id/receive', { __id: po.id, lines: [{ line_id: lineId, received_qty: 5, lot_no: 'LOT-C' }] });
  assert.equal(call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-002', amount: 520 }).status, 200);
  const recon = call(routes, 'GET', '/api/purchase_orders/:id/reconciliation', { __id: po.id });
  assert.equal(recon.json.summary.status, 'variance');
  assert.equal(recon.json.summary.variance, 20);
});

test('PC.6 发票：未收货不允许录入；发票号重复拒绝', () => {
  const po = createPo(routes, 2, 100);
  let r = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-003', amount: 200 });
  assert.equal(r.status, 400, 'draft 不允许录发票');
  confirmPo(routes, po.id);
  const lineId = db.prepare('SELECT id FROM po_lines WHERE po_id = ?').get(po.id).id;
  call(routes, 'POST', '/api/purchase_orders/:id/receive', { __id: po.id, lines: [{ line_id: lineId, received_qty: 2, lot_no: 'LOT-D' }] });
  assert.equal(call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-004', amount: 200 }).status, 200);
  r = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-004', amount: 100 });
  assert.equal(r.status, 400, '发票号重复应拒绝');
});
