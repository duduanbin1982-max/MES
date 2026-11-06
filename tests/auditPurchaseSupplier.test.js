'use strict';

/**
 * auditPurchaseSupplier.test.js
 * 2026-11-07 采购管理 / 供应商管理 审计修复验证（内存 SQLite，服务直调）：
 *   PS.1  采购单创建校验：停用供应商、项目不存在、非有限数量/单价
 *   PS.2  收货状态机：未审批（submitted）不允许收货
 *   PS.3  超额收货拒绝 + 事务回滚
 *   PS.4  采购/发票关键动作写入业务审计（audit_logs）
 *   PS.5  发票金额/税额有限数与大小关系校验
 *   PS.6  发票 matched 闸门：对账有差异拒绝 matched，匹配后可 paid
 *   PS.7  对账汇总补充税额、含税总额、超额标记
 *   PS.8  供应商创建：评级枚举、编码大小写唯一、is_active 布尔化、分类枚举
 *   PS.9  供应商更新：空名称 / 非法评级拒绝
 *   PS.10 供应商删除保护：外协/来料检验/采购单引用 409；仅评分快照时清理
 *   PS.11 外协订单：供应商不存在不落库、金额/进度校验、创建审计
 *   PS.12 来料检验：defect_qty > sample_qty / 负数拒绝
 *   PS.13 评分卡：period 格式校验 + 分数范围
 *   PS.14 供应商看板：无 purchase/quality 权限 403
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_code TEXT UNIQUE NOT NULL, supplier_name TEXT NOT NULL,
      contact_person TEXT, phone TEXT, email TEXT, address TEXT, payment_terms TEXT, rating TEXT DEFAULT 'B',
      is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, unit TEXT DEFAULT 'pcs');
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE key_components (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, component_type TEXT, unit_price REAL);
    CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER NOT NULL, actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT, currency TEXT DEFAULT 'CNY', valid_from TEXT, notes TEXT, priced_at TEXT);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT UNIQUE NOT NULL, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT DEFAULT 'pending', notes TEXT);
    CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT 'available', last_updated TEXT);
    CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT UNIQUE NOT NULL, supplier_id INTEGER NOT NULL,
      equipment_instance_id INTEGER, status TEXT NOT NULL DEFAULT 'draft', ordered_date TEXT, expected_date TEXT,
      subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total_amount REAL DEFAULT 0, currency TEXT DEFAULT 'CNY',
      payment_terms TEXT, created_by INTEGER, approved_by INTEGER, approved_at TEXT, closed_at TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE po_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, po_id INTEGER NOT NULL, material_id INTEGER NOT NULL, quantity REAL NOT NULL,
      unit TEXT, unit_price REAL NOT NULL, line_amount REAL NOT NULL, expected_date TEXT, received_qty REAL DEFAULT 0,
      lot_no_at_receipt TEXT, notes TEXT, line_no INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT NOT NULL,
      resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT,
      ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeRoutes(db) {
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes['GET ' + path] = handlers; },
    post: (path, ...handlers) => { routes['POST ' + path] = handlers; },
    put: (path, ...handlers) => { routes['PUT ' + path] = handlers; },
    patch: (path, ...handlers) => { routes['PATCH ' + path] = handlers; },
    delete: (path, ...handlers) => { routes['DELETE ' + path] = handlers; },
  };
  require('../services/purchase').register(app, db);
  require('../services/supplierCollaboration').register(app, db);
  require('../services/supplierDashboardService').register(app, db);
  return routes;
}

function call(routes, method, path, body = {}, user = null) {
  const key = method + ' ' + path;
  const chain = routes[key];
  if (!chain) throw new Error('no route: ' + key);
  const params = {};
  for (const token of path.match(/:([A-Za-z_]+)/g) || []) params[token.slice(1)] = body.__id;
  const req = { body, query: body.__query || {}, params, user };
  let status = 200;
  let json = null;
  const res = {
    status: (code) => { status = code; return res; },
    json: (payload) => { json = payload; return res; },
  };
  let index = 0;
  const next = (error) => {
    if (error) {
      status = error.status || 500;
      json = { error: error.message, code: error.code, details: error.details };
      return;
    }
    const handler = chain[index++];
    if (!handler) return;
    try { handler(req, res, next); } catch (caught) { next(caught); }
  };
  next();
  return { status, json };
}

let db;
let routes;
let seq = 0;

function createSupplier(overrides = {}) {
  seq += 1;
  const res = call(routes, 'POST', '/api/suppliers', Object.assign({
    supplier_code: 'SUP-' + seq,
    supplier_name: '供应商' + seq,
  }, overrides));
  assert.equal(res.status, 200, '创建供应商失败: ' + JSON.stringify(res.json));
  return res.json.id;
}

function createPo({ quantity = 5, unitPrice = 100, supplierId, equipmentInstanceId } = {}) {
  const sid = supplierId || createSupplier();
  const res = call(routes, 'POST', '/api/purchase_orders', {
    supplier_id: sid,
    equipment_instance_id: equipmentInstanceId,
    lines: [{ material_id: 101, quantity, unit_price: unitPrice }],
  });
  assert.equal(res.status, 200, '创建采购单失败: ' + JSON.stringify(res.json));
  return Object.assign({ supplierId: sid }, res.json);
}

function confirmPo(poId) {
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id: poId }).status, 200);
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed', approved_by: 2, __id: poId }).status, 200);
}

function receivePo(poId, receivedQty, lotNo) {
  const line = db.prepare('SELECT id FROM po_lines WHERE po_id = ?').get(poId);
  return call(routes, 'POST', '/api/purchase_orders/:id/receive', {
    __id: poId,
    lines: [{ line_id: line.id, received_qty: receivedQty, lot_no: lotNo }],
  });
}

test.beforeEach(() => {
  db = freshDb();
  db.prepare('INSERT INTO users (id, username, full_name, role) VALUES (1, ?, ?, ?)').run('creator', '创建人', 'planner');
  db.prepare('INSERT INTO users (id, username, full_name, role) VALUES (2, ?, ?, ?)').run('approver', '审批人', 'admin');
  db.prepare('INSERT INTO materials (id, material_code, material_name, unit) VALUES (101, ?, ?, ?)').run('M-101', '钢板', 'kg');
  db.prepare('INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, ?, ?)').run('TBM-1', '一号机');
  routes = makeRoutes(db);
});

test('PS.1 采购单创建：停用供应商 400 / 项目不存在 404 / 非有限数量 400', () => {
  const inactive = createSupplier({ supplier_code: 'SUP-OFF', supplier_name: '停用供应商', is_active: 0 });
  let res = call(routes, 'POST', '/api/purchase_orders', {
    supplier_id: inactive,
    lines: [{ material_id: 101, quantity: 1, unit_price: 10 }],
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /停用/);

  const active = createSupplier({ supplier_code: 'SUP-ON', supplier_name: '在用供应商' });
  res = call(routes, 'POST', '/api/purchase_orders', {
    supplier_id: active,
    equipment_instance_id: 999,
    lines: [{ material_id: 101, quantity: 1, unit_price: 10 }],
  });
  assert.equal(res.status, 404);
  assert.match(res.json.error, /关联项目不存在/);

  for (const badLine of [
    { material_id: 101, quantity: 'Infinity', unit_price: 10 },
    { material_id: 101, quantity: 1, unit_price: 'abc' },
    { material_id: 101, quantity: 0, unit_price: 10 },
  ]) {
    res = call(routes, 'POST', '/api/purchase_orders', { supplier_id: active, lines: [badLine] });
    assert.equal(res.status, 400, JSON.stringify(badLine));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c, 0, '非法创建不应落库');
});

test('PS.2 收货状态机：submitted（未审批）不允许收货，审批后可收', () => {
  const po = createPo();
  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'submitted', __id: po.id }).status, 200);
  let res = receivePo(po.id, 1, 'LOT-SUB');
  assert.equal(res.status, 400);
  assert.match(res.json.error, /不允许收货/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchase_receiving').get().c, 0);

  assert.equal(call(routes, 'PATCH', '/api/purchase_orders/:id/status', { status: 'confirmed', approved_by: 2, __id: po.id }).status, 200);
  res = receivePo(po.id, 1, 'LOT-SUB');
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.po_status, 'partially_received');
});

test('PS.3 超额收货拒绝 + 事务回滚', () => {
  const po = createPo({ quantity: 5 });
  confirmPo(po.id);
  const res = receivePo(po.id, 6, 'LOT-OVER');
  assert.equal(res.status, 400);
  assert.match(res.json.error, /超量/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchase_receiving').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM material_lots').get().c, 0);
  assert.equal(db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.id).status, 'confirmed');
});

test('PS.4 采购创建/审批/收货/发票写入 audit_logs', () => {
  const po = createPo({ quantity: 5, unitPrice: 100 });
  confirmPo(po.id);
  assert.equal(receivePo(po.id, 5, 'LOT-AUDIT').status, 200);
  const invoice = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-AUDIT', amount: 500 });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.json));

  const actions = db.prepare('SELECT action, resource_type, resource_id FROM audit_logs ORDER BY id').all();
  const names = actions.map((row) => row.action);
  for (const action of ['purchase_order.create', 'purchase_order.status', 'purchase_order.receive', 'purchase_invoice.create']) {
    assert.ok(names.includes(action), '缺少审计动作 ' + action);
  }
  const receiveAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'purchase_order.receive'").get();
  assert.equal(Number(receiveAudit.resource_id), po.id);
  assert.match(receiveAudit.after_json, /"status":"received"/);
});

test('PS.5 发票金额/税额校验', () => {
  const po = createPo({ quantity: 5, unitPrice: 100 });
  confirmPo(po.id);
  receivePo(po.id, 5, 'LOT-INV');
  const base = { __id: po.id, invoice_no: 'INV-CHK', amount: 500 };

  let res = call(routes, 'POST', '/api/purchase_orders/:id/invoices', Object.assign({}, base, { tax_amount: -1 }));
  assert.equal(res.status, 400);
  assert.match(res.json.error, /tax_amount/);

  res = call(routes, 'POST', '/api/purchase_orders/:id/invoices', Object.assign({}, base, { tax_amount: 600 }));
  assert.equal(res.status, 400);
  assert.match(res.json.error, /不能大于/);

  res = call(routes, 'POST', '/api/purchase_orders/:id/invoices', Object.assign({}, base, { amount: 'Infinity' }));
  assert.equal(res.status, 400);

  res = call(routes, 'POST', '/api/purchase_orders/:id/invoices', Object.assign({}, base, { invoice_no: '  ' }));
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchase_invoices').get().c, 0);
});

test('PS.6 发票 matched 闸门：差异拒绝、匹配后允许 paid', () => {
  const po = createPo({ quantity: 5, unitPrice: 100 });
  confirmPo(po.id);
  receivePo(po.id, 5, 'LOT-MATCH');

  const over = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-OVER', amount: 520 });
  assert.equal(over.status, 200);
  let res = call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: over.json.id, status: 'matched' });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /不一致/);
  assert.equal(res.json.details.variance, 20);
  assert.equal(call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: over.json.id, status: 'void' }).status, 200);

  const ok = call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-OK', amount: 500, tax_amount: 65 });
  assert.equal(ok.status, 200);
  res = call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: ok.json.id, status: 'matched' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(call(routes, 'PATCH', '/api/purchase_invoices/:id', { __id: ok.json.id, status: 'paid' }).status, 200);
});

test('PS.7 对账汇总：税额/含税总额/超额标记', () => {
  const po = createPo({ quantity: 5, unitPrice: 100 });
  confirmPo(po.id);
  receivePo(po.id, 5, 'LOT-RECON');
  assert.equal(call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-R1', amount: 400, tax_amount: 52 }).status, 200);
  assert.equal(call(routes, 'POST', '/api/purchase_orders/:id/invoices', { __id: po.id, invoice_no: 'INV-R2', amount: 100, tax_amount: 13 }).status, 200);

  const recon = call(routes, 'GET', '/api/purchase_orders/:id/reconciliation', { __id: po.id });
  assert.equal(recon.status, 200);
  assert.equal(recon.json.summary.invoiced_amount, 500);
  assert.equal(recon.json.summary.invoiced_tax_amount, 65);
  assert.equal(recon.json.summary.invoice_total_amount, 565);
  assert.equal(recon.json.summary.over_invoiced, true);
  assert.equal(recon.json.summary.variance, 0);

  const detail = call(routes, 'GET', '/api/purchase_orders/:id', { __id: po.id });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.reconciliation.invoiced_tax_amount, 65);
  assert.equal(detail.json.reconciliation.invoice_total_amount, 565);
  assert.equal(detail.json.reconciliation.over_invoiced, true);
});

test('PS.8 供应商创建：评级枚举 / 编码大小写唯一 / is_active 布尔化 / 分类枚举', () => {
  let res = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-BAD', supplier_name: '评级非法', rating: 'Z' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /rating/);

  res = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-DUP', supplier_name: '重复A' });
  assert.equal(res.status, 200);
  res = call(routes, 'POST', '/api/suppliers', { supplier_code: ' sup-dup ', supplier_name: '重复B' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /已存在/);

  const off = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-OFF2', supplier_name: '布尔化', is_active: 'false' });
  assert.equal(off.status, 200);
  assert.equal(db.prepare('SELECT is_active FROM suppliers WHERE id = ?').get(off.json.id).is_active, 0);

  res = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-CAT', supplier_name: '分类非法', supplier_category: 'alien' });
  assert.equal(res.status, 400);
  res = call(routes, 'POST', '/api/suppliers', { supplier_code: 'SUP-CAT2', supplier_name: '分类非法2', business_categories: ['general', 'alien'] });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /非法分类/);
});

test('PS.9 供应商更新：空名称 / 非法评级拒绝', () => {
  const id = createSupplier({ supplier_code: 'SUP-UPD', supplier_name: '待更新' });
  let res = call(routes, 'PATCH', '/api/suppliers/:id', { __id: id, supplier_name: '   ' });
  assert.equal(res.status, 400);
  res = call(routes, 'PATCH', '/api/suppliers/:id', { __id: id, rating: 'S' });
  assert.equal(res.status, 400);
  res = call(routes, 'PATCH', '/api/suppliers/:id', { __id: id, rating: 'a', is_active: false });
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT rating, is_active FROM suppliers WHERE id = ?').get(id);
  assert.equal(row.rating, 'A');
  assert.equal(row.is_active, 0);
});

test('PS.10 供应商删除保护：采购/外协/来料检验引用 409；仅评分快照时清理', () => {
  const poSupplier = createSupplier({ supplier_code: 'SUP-PO-REF', supplier_name: '有采购单' });
  createPo({ supplierId: poSupplier });
  let res = call(routes, 'DELETE', '/api/suppliers/:id', { __id: poSupplier });
  assert.equal(res.status, 409);
  assert.equal(res.json.details.references.purchase_orders, 1);

  const outSupplier = createSupplier({ supplier_code: 'SUP-OUT-REF', supplier_name: '有外协单' });
  assert.equal(call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', {
    supplier_id: outSupplier, item_name: '刀盘加工', contract_amount: 1000,
  }).status, 200);
  res = call(routes, 'DELETE', '/api/suppliers/:id', { __id: outSupplier });
  assert.equal(res.status, 409);
  assert.equal(res.json.details.references.outsourcing_orders, 1);

  const scoreOnly = createSupplier({ supplier_code: 'SUP-SCORE', supplier_name: '仅评分' });
  db.prepare("INSERT INTO supplier_score_snapshots (supplier_id, period, total_score, grade) VALUES (?, '2026-07', 88, 'B')").run(scoreOnly);
  res = call(routes, 'DELETE', '/api/suppliers/:id', { __id: scoreOnly });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM supplier_score_snapshots WHERE supplier_id = ?').get(scoreOnly).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM suppliers WHERE id = ?').get(scoreOnly).c, 0);
});

test('PS.11 外协订单：供应商不存在不落库 / 金额与进度校验 / 创建审计', () => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM outsourcing_orders').get().c;
  let res = call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', { supplier_id: 9999, item_name: '幽灵订单' });
  assert.equal(res.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM outsourcing_orders').get().c, before, '失败不应落库');

  const inactive = createSupplier({ supplier_code: 'SUP-OUT-OFF', supplier_name: '停用外协', is_active: 0 });
  res = call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', { supplier_id: inactive, item_name: '停用订单' });
  assert.equal(res.status, 400);

  const active = createSupplier({ supplier_code: 'SUP-OUT-OK', supplier_name: '外协供应商' });
  res = call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', { supplier_id: active, item_name: '进度越界', progress_pct: 120 });
  assert.equal(res.status, 400);
  res = call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', { supplier_id: active, item_name: '负金额', contract_amount: -5 });
  assert.equal(res.status, 400);

  res = call(routes, 'POST', '/api/supplier-collab/outsourcing-orders', { supplier_id: active, item_name: '正常外协', progress_pct: 20, contract_amount: 500 });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE action = 'supplier.outsourcing.create'").get();
  assert.ok(auditRow, '外协创建应写审计');
  assert.equal(Number(auditRow.resource_id), res.json.id);
});

test('PS.12 来料检验：defect_qty > sample_qty / 负数拒绝', () => {
  let res = call(routes, 'POST', '/api/supplier-collab/incoming-inspections', { receiving_id: 1, result: 'pass', sample_qty: 1, defect_qty: 2 });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /defect_qty/);

  res = call(routes, 'POST', '/api/supplier-collab/incoming-inspections', { receiving_id: 1, result: 'pass', sample_qty: -3, defect_qty: 0 });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /sample_qty/);
});

test('PS.13 评分卡：period 格式校验 + 分数范围', () => {
  const id = createSupplier({ supplier_code: 'SUP-SCORE2', supplier_name: '评分供应商' });
  let res = call(routes, 'GET', '/api/supplier-collab/scorecards', { __query: { period: '2026-13' } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /YYYY-MM/);

  res = call(routes, 'GET', '/api/supplier-collab/scorecards', { __query: { supplier_id: id, period: '2026-07' } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  for (const key of ['delivery_score', 'quality_score', 'service_score', 'total_score']) {
    const value = Number(res.json[key]);
    assert.ok(value >= 0 && value <= 100, key + ' 越界: ' + value);
  }
});

test('PS.14 供应商看板权限：无 purchase/quality 权限 403', () => {
  const denied = call(routes, 'GET', '/api/supplier/dashboard', {}, { role: 'welder', permissions: ['shopfloor:read'] });
  assert.equal(denied.status, 403);
  assert.match(denied.json.error, /权限不足/);

  const allowed = call(routes, 'GET', '/api/supplier/dashboard', {}, { role: 'purchaser', permissions: ['purchase:read'] });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.ok(Array.isArray(allowed.json.suppliers));
});
