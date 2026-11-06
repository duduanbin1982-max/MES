'use strict';

/**
 * shopfloorGovernance.test.js
 * 2026-11-06 车间工作台审计整改验证：
 *   SH-1 操作人必须来自登录用户（禁止冒充）
 *   SH-2 动作白名单 + 状态机（已完成工单不能重新开始）
 *   SH-3 工时/数量校验（负工时、负数、超计划完成）
 *   SH-4 QC 结果校验
 *   SH-5 工作台数据范围（工人只看自己的工单/报工）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const scanner = require('../services/scanner');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, role TEXT)`);
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)`);
  db.exec(`CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT)`);
  db.exec(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT UNIQUE, title TEXT, status TEXT DEFAULT 'pending', equipment_instance_id INTEGER, workstation_id INTEGER, assigned_to INTEGER, quantity_planned INTEGER, quantity_completed INTEGER DEFAULT 0, actual_start TEXT, actual_end TEXT, planned_end TEXT)`);
  db.exec(`CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id INTEGER, operator_id INTEGER, action TEXT, hours_worked REAL, quantity_completed INTEGER, defect_quantity INTEGER, notes TEXT)`);
  db.exec(`CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, status TEXT DEFAULT 'ready', work_order_id INTEGER, actual_start TEXT, actual_end TEXT)`);
  db.exec(`CREATE TABLE process_executions (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, operator_id INTEGER, action TEXT, hours_worked REAL, quantity_completed INTEGER DEFAULT 0, defect_quantity INTEGER DEFAULT 0, notes TEXT)`);
  return db;
}

function resStub() {
  const state = { status: 200, body: null };
  const res = {
    status(code) { state.status = code; return res; },
    json(payload) { state.body = payload; return res; },
  };
  return { res, state };
}

function scan(db, body, user) {
  const { res, state } = resStub();
  try {
    scanner.scanExecute({ body, user }, res, db);
    return { status: state.status, body: state.body };
  } catch (error) {
    return { status: error.status || 500, body: { error: error.message } };
  }
}

let db;
test.beforeEach(() => {
  db = freshDb();
  db.prepare(`INSERT INTO users (id, full_name, role) VALUES (7, '张三', 'worker'), (1, '管理员', 'admin')`).run();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code) VALUES (1, 'TBM-1')`).run();
  db.prepare(`INSERT INTO work_orders (id, wo_code, title, status, equipment_instance_id, assigned_to, quantity_planned, quantity_completed) VALUES (1, 'WO-1', '测试工单', 'pending', 1, 7, 2, 0)`).run();
  db.prepare(`INSERT INTO work_orders (id, wo_code, title, status, equipment_instance_id, assigned_to, quantity_planned, quantity_completed) VALUES (2, 'WO-2', '已完成工单', 'completed', 1, 8, 1, 1)`).run();
});

test('SH-2 动作白名单 + 状态机校验', () => {
  assert.throws(() => scanner.validateScanAction('work_order', 'hack'), /不支持的动作/);
  assert.equal(scanner.validateScanAction('work_order', 'start'), true);
  assert.throws(() => scanner.assertStatusTransition('work_order', 'completed', 'start'), /终态/);
  assert.throws(() => scanner.assertStatusTransition('work_order', 'in_progress', 'start'), /不能执行/);
  assert.equal(scanner.assertStatusTransition('work_order', 'pending', 'start'), true);
});

test('SH-1 操作人：默认取登录用户；工人不能冒充他人；主管可代操作', () => {
  const worker = { uid: 7, role: 'worker', permissions: ['shopfloor:write'] };
  assert.equal(scanner.resolveScanOperator({ user: worker }, {}), 7);
  assert.throws(() => scanner.resolveScanOperator({ user: worker }, { operator_id: 1 }), /不能代替他人/);
  const admin = { uid: 1, role: 'admin', permissions: ['*'] };
  assert.equal(scanner.resolveScanOperator({ user: admin }, { operator_id: 7 }), 7);
});

test('SH-3 工时/数量校验', () => {
  assert.throws(() => scanner.validateScanQuantities({ hours_worked: -1 }), /hours_worked/);
  assert.throws(() => scanner.validateScanQuantities({ hours_worked: 25 }), /hours_worked/);
  assert.throws(() => scanner.validateScanQuantities({ quantity_completed: -2 }), /quantity_completed/);
  assert.throws(() => scanner.validateScanQuantities({ action: 'qc', result: 'weird' }), /result/);
  const ok = scanner.validateScanQuantities({ hours_worked: 2, quantity_completed: 1 });
  assert.equal(ok.hours, 2);
  assert.equal(ok.quantityCompleted, 1);
});

test('SH-4 扫码执行：start→in_progress；重复 start 拒绝；complete 达标完成；已完成不能再 start', () => {
  const worker = { uid: 7, role: 'worker', permissions: ['shopfloor:write'] };
  let result = scan(db, { code: 'WO-1', action: 'start' }, worker);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status_after, 'in_progress');
  assert.equal(db.prepare('SELECT status FROM work_orders WHERE id = 1').get().status, 'in_progress');
  const operation = db.prepare('SELECT * FROM work_order_operations ORDER BY id DESC LIMIT 1').get();
  assert.equal(operation.operator_id, 7, '操作人来自登录用户');

  result = scan(db, { code: 'WO-1', action: 'start' }, worker);
  assert.equal(result.status, 400, '重复 start 应拒绝');

  result = scan(db, { code: 'WO-1', action: 'complete', quantity_completed: 2 }, worker);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status_after, 'completed');
  const workOrder = db.prepare('SELECT status, quantity_completed FROM work_orders WHERE id = 1').get();
  assert.equal(workOrder.status, 'completed');
  assert.equal(workOrder.quantity_completed, 2);

  result = scan(db, { code: 'WO-1', action: 'start' }, worker);
  assert.equal(result.status, 400, '已完成工单不能再开始');
  result = scan(db, { code: 'WO-2', action: 'start' }, worker);
  assert.equal(result.status, 400, '终态工单不能开始');
});

test('SH-3b 扫码完成超计划、负工时、冒充操作人均拒绝', () => {
  const worker = { uid: 7, role: 'worker', permissions: ['shopfloor:write'] };
  scan(db, { code: 'WO-1', action: 'start' }, worker);
  let result = scan(db, { code: 'WO-1', action: 'complete', quantity_completed: 5 }, worker);
  assert.equal(result.status, 400, '超计划完成应拒绝');
  assert.match(result.body.error, /超过计划/);
  result = scan(db, { code: 'WO-1', action: 'complete', hours_worked: -2, quantity_completed: 1 }, worker);
  assert.equal(result.status, 400);
  result = scan(db, { code: 'WO-1', action: 'complete', operator_id: 1, quantity_completed: 1 }, worker);
  assert.equal(result.status, 403, '工人不能冒充他人扫码');
});

test('SH-5 工作台数据范围：worker 只看自己/未分配的工单，管理员看全部', () => {
  const service = require('../services/shopfloorService');
  const routes = {};
  const app = {
    get: (path, handler) => { routes['GET ' + path] = handler; },
    post: () => {}, put: () => {}, delete: () => {},
  };
  db.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, issued_at TEXT, equipment_instance_id INTEGER)`);
  db.exec(`CREATE TABLE doc_acknowledgements (id INTEGER PRIMARY KEY, doc_id INTEGER, ack_by INTEGER)`);
  db.exec(`CREATE TABLE exception_cases (id INTEGER PRIMARY KEY, exception_id INTEGER, status TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE work_report_details (id INTEGER PRIMARY KEY, work_order_id INTEGER, worker_id INTEGER, hours_spent REAL, reported_at TEXT)`);
  db.exec(`CREATE TABLE qc_inspections (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, inspector_id INTEGER, inspection_date TEXT, result TEXT)`);
  service.register(app, db);
  const handler = routes['GET /api/shopfloor/overview'];

  const call = (user) => {
    let payload = null;
    handler({ user, query: {} }, { json: (value) => { payload = value; }, status: () => {} });
    return payload;
  };
  const workerView = call({ uid: 7, role: 'worker' });
  assert.equal(workerView.scope, 'self');
  assert.deepEqual(workerView.work_orders.map((row) => row.wo_code).sort(), ['WO-1'], 'worker 只看到自己的工单');
  const adminView = call({ uid: 1, role: 'admin' });
  assert.equal(adminView.scope, 'all');
  assert.equal(adminView.work_orders.length, 1, '管理员看到所有未完成工单（WO-2 已完成被排除）');
});
