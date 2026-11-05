'use strict';

/**
 * deliveryChain.test.js
 * 2026-11-05 交付链路深挖（里程碑 → 交付单 → 验收签署 → 收款 → 看板汇总）整改验证：
 *   1) 交付单状态机 + actual_date（本地日期）
 *   2) 验收签署 passed/conditional 联动交付单（arrived→accepted）与合同里程碑（completed）
 *   3) 验收签署校验（signer 必填、conditional 必须有 condition_note、rejected 不改交付单）
 *   4) 收款登记校验（金额>0、项目存在、里程碑归属、凭证号唯一）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT)`);
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY AUTOINCREMENT, instance_code TEXT, instance_name TEXT, contract_amount REAL DEFAULT 0)`);
  db.exec(`CREATE TABLE delivery_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_no TEXT UNIQUE, equipment_instance_id INTEGER, milestone_id INTEGER, delivery_type TEXT, planned_date TEXT, actual_date TEXT, status TEXT DEFAULT 'planned', transport_mode TEXT, carrier TEXT, tracking_no TEXT, ship_to TEXT, contact_name TEXT, contact_phone TEXT, package_count INTEGER, gross_weight REAL, certificate_document_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE acceptance_records (id INTEGER PRIMARY KEY AUTOINCREMENT, acceptance_no TEXT UNIQUE, equipment_instance_id INTEGER, delivery_order_id INTEGER, milestone_id INTEGER, acceptance_type TEXT, planned_date TEXT, actual_date TEXT, result TEXT DEFAULT 'pending', condition_note TEXT, customer_name TEXT, signer_name TEXT, signer_title TEXT, signed_at TEXT, report_document_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE contract_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, milestone_name TEXT, planned_date TEXT, actual_date TEXT, payment_pct REAL DEFAULT 0, payment_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending', sequence INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
  db.exec(`CREATE TABLE project_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, milestone_id INTEGER, amount REAL, received_date TEXT, payment_method TEXT, voucher_no TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  return db;
}

function makeRoutes(db) {
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; }, put: (p, h) => { routes['PUT ' + p] = h; }, delete: (p, h) => { routes['DELETE ' + p] = h; } };
  require('../services/delivery/records').registerDeliveryRecordRoutes(app, db);
  require('../services/tbmAdvanced/projectDashboard').registerRoutes(app, db);
  return routes;
}

function call(routes, method, path, body) {
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query: {}, params, user: { uid: 1, role: 'admin' } };
  let status = 200;
  let json = null;
  const res = { status: (code) => { status = code; return res; }, json: (payload) => { json = payload; return res; } };
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
  db.prepare(`INSERT INTO users (id, username, full_name) VALUES (1, 'admin', '管理员')`).run();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, instance_name, contract_amount) VALUES (1, 'TBM-001', '测试盾构', 1000000)`).run();
  routes = makeRoutes(db);
});

function createDelivery(instanceId = 1) {
  return call(routes, 'POST', '/api/equipment_instances/:id/deliveries', {
    __id: instanceId,
    delivery_type: 'machine',
    planned_date: '2026-11-30',
    transport_mode: 'road',
  }).json;
}

test('DC.1 交付单状态机：planned→shipped 记录实际日期；非法流转拒绝', () => {
  const delivery = createDelivery();
  assert.ok(delivery.item.id);
  let result = call(routes, 'POST', '/api/deliveries/:id/status', { __id: delivery.item.id, status: 'shipped' });
  assert.equal(result.status, 200);
  assert.equal(result.json.item.status, 'shipped');
  assert.match(String(result.json.item.actual_date), /^\d{4}-\d{2}-\d{2}$/, '实际日期应为本地 YYYY-MM-DD');
  result = call(routes, 'POST', '/api/deliveries/:id/status', { __id: delivery.item.id, status: 'accepted' });
  assert.equal(result.status, 400, 'shipped 不能直接 accepted');
});

test('DC.2 验收签署 passed 联动交付单 arrived→accepted 与里程碑 completed', () => {
  const delivery = createDelivery();
  const deliveryId = delivery.item.id;
  call(routes, 'POST', '/api/deliveries/:id/status', { __id: deliveryId, status: 'shipped' });
  call(routes, 'POST', '/api/deliveries/:id/status', { __id: deliveryId, status: 'in_transit' });
  call(routes, 'POST', '/api/deliveries/:id/status', { __id: deliveryId, status: 'arrived' });

  const milestone = call(routes, 'POST', '/api/contract-milestones', { equipment_instance_id: 1, milestone_name: '发货款', payment_pct: 30, payment_amount: 300000 }).json;
  const acceptance = call(routes, 'POST', '/api/equipment_instances/:id/acceptances', {
    __id: 1,
    acceptance_type: 'sat',
    delivery_order_id: deliveryId,
    milestone_id: milestone.id,
    planned_date: '2026-12-01',
  });
  assert.equal(acceptance.status, 200, JSON.stringify(acceptance.json));
  const signed = call(routes, 'POST', '/api/acceptances/:id/sign', { __id: acceptance.json.id, result: 'passed', signer_name: '张工', signer_title: '客户代表' });
  assert.equal(signed.status, 200, JSON.stringify(signed.json));
  assert.equal(signed.json.item.result, 'passed');
  const deliveryAfter = call(routes, 'GET', '/api/equipment_instances/:id/deliveries', { __id: 1 }).json.items[0];
  assert.equal(deliveryAfter.status, 'accepted', '验收通过后交付单应 accepted');
  const milestoneAfter = db.prepare(`SELECT status FROM contract_milestones WHERE id = ?`).get(milestone.id);
  assert.equal(milestoneAfter.status, 'completed', '验收通过后合同里程碑应 completed');
});

test('DC.3 验收签署校验：signer 必填、conditional 必须填条件、rejected 不改交付单', () => {
  const delivery = createDelivery();
  const deliveryId = delivery.item.id;
  const acceptance = call(routes, 'POST', '/api/equipment_instances/:id/acceptances', { __id: 1, acceptance_type: 'fat', delivery_order_id: deliveryId }).json;
  let result = call(routes, 'POST', '/api/acceptances/:id/sign', { __id: acceptance.id, result: 'passed' });
  assert.equal(result.status, 400, 'signer_name 必填');
  result = call(routes, 'POST', '/api/acceptances/:id/sign', { __id: acceptance.id, result: 'conditional', signer_name: '张工' });
  assert.equal(result.status, 400, 'conditional 必须填 condition_note');
  result = call(routes, 'POST', '/api/acceptances/:id/sign', { __id: acceptance.id, result: 'rejected', signer_name: '张工' });
  assert.equal(result.status, 200);
  const deliveryAfter = call(routes, 'GET', '/api/equipment_instances/:id/deliveries', { __id: 1 }).json.items[0];
  assert.equal(deliveryAfter.status, 'planned', 'rejected 不应改动交付单');
});

test('DC.4 收款校验：金额/项目/里程碑归属/凭证号唯一', () => {
  const milestone = call(routes, 'POST', '/api/contract-milestones', { equipment_instance_id: 1, milestone_name: '预付款', payment_pct: 30, payment_amount: 300000 }).json;
  let result = call(routes, 'POST', '/api/project-payments', { equipment_instance_id: 1, amount: 0 });
  assert.equal(result.status, 400, '金额必须 > 0');
  result = call(routes, 'POST', '/api/project-payments', { equipment_instance_id: 999, amount: 100 });
  assert.equal(result.status, 400, '项目不存在');
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (2, 'TBM-002', '另一台')`).run();
  const otherMilestone = call(routes, 'POST', '/api/contract-milestones', { equipment_instance_id: 2, milestone_name: '其它项目里程碑' }).json;
  result = call(routes, 'POST', '/api/project-payments', { equipment_instance_id: 1, milestone_id: otherMilestone.id, amount: 100 });
  assert.equal(result.status, 400, '里程碑不属于该实例');
  result = call(routes, 'POST', '/api/project-payments', { equipment_instance_id: 1, milestone_id: milestone.id, amount: 300000, voucher_no: 'PAY-1' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.match(String(result.json.received_date), /^\d{4}-\d{2}-\d{2}$/, '收款日期默认本地日期');
  result = call(routes, 'POST', '/api/project-payments', { equipment_instance_id: 1, amount: 1, voucher_no: 'PAY-1' });
  assert.equal(result.status, 409, '凭证号重复应 409');
  const summary = call(routes, 'GET', '/api/project-summary/:id', { __id: 1 });
  assert.equal(summary.json.total_payment, 300000);
});
