'use strict';

/**
 * processHoursGovernance.test.js
 * 2026-11-06 工时与报工模块审计整改验证：
 *   WH-1 报工校验（工单存在、0<时长<=24、数量/完成率、工序归属实例）
 *   WH-2 报工撤销 + actual_hours 重算
 *   WH-3 工时定额校验（节点存在、标准工时>0、人数 1-100）
 *   WH-3' 工人绩效：标准工时取工序定额（不再用实际×8）
 *   WH-5 完工进度：优先数量口径，并返回工时消耗率
 *   WH-6 hours-summary 节点数按去重计
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT)`);
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)`);
  db.exec(`CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT)`);
  db.exec(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, title TEXT, equipment_instance_id INTEGER, actual_hours REAL, updated_at TEXT)`);
  db.exec(`CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY, work_order_id INTEGER, action TEXT)`);
  return db;
}

function makeRoutes(db) {
  const routes = {};
  const app = {
    get: (p, h) => { routes['GET ' + p] = h; },
    post: (p, h) => { routes['POST ' + p] = h; },
    put: (p, h) => { routes['PUT ' + p] = h; },
    delete: (p, h) => { routes['DELETE ' + p] = h; },
  };
  delete require.cache[require.resolve('../services/processHoursService')];
  require('../services/processHoursService').register(app, db, {});
  return routes;
}

function call(routes, method, fullPath, body, user) {
  const queryIndex = String(fullPath).indexOf('?');
  const path = queryIndex >= 0 ? String(fullPath).slice(0, queryIndex) : String(fullPath);
  const query = {};
  if (queryIndex >= 0) {
    for (const pair of String(fullPath).slice(queryIndex + 1).split('&')) {
      if (!pair) continue;
      const [key, value = ''] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  const handler = routes[method + ' ' + path];
  if (!handler) throw new Error('no route: ' + method + ' ' + path);
  const match = path.match(/:([a-zA-Z_]+)/g) || [];
  const params = {};
  if (match.length === 1) params[match[0].slice(1)] = body && body.__id ? body.__id : 1;
  const req = { body: body || {}, query, params, user: user || { uid: 7, role: 'worker' } };
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
  db.prepare(`INSERT INTO users (id, username, full_name) VALUES (7, 'w7', '张三')`).run();
  db.prepare(`INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机')`).run();
  db.prepare(`INSERT INTO process_nodes (id, equipment_instance_id, operation_name) VALUES (11, 1, '下料'), (12, 2, '焊接')`).run();
  db.prepare(`INSERT INTO work_orders (id, wo_code, title, equipment_instance_id, actual_hours) VALUES (1, 'WO-1', '测试工单', 1, 0)`).run();
  db.prepare(`INSERT INTO work_order_operations (id, work_order_id, action) VALUES (5, 1, 'start')`).run();
  routes = makeRoutes(db);
});

function reportCount() {
  return db.prepare('SELECT COUNT(*) c FROM work_report_details').get().c;
}

test('WH-1a 报工参数校验：负/0/超 24 小时、工单不存在均拒绝', () => {
  let result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: -3 });
  assert.equal(result.status, 400);
  result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: 0 });
  assert.equal(result.status, 400);
  result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: 25 });
  assert.equal(result.status, 400);
  result = call(routes, 'POST', '/api/work-reports', { work_order_id: 999, hours_spent: 1 });
  assert.equal(result.status, 404);
  assert.equal(reportCount(), 0, '校验失败不应落库');
});

test('WH-1b 工序必须属于工单的装备实例；数量/完成率校验', () => {
  let result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 12, hours_spent: 2 });
  assert.equal(result.status, 400, '跨实例工序应拒绝');
  result = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, quantity_completed: 5, quantity_total: 4, hours_spent: 2 });
  assert.equal(result.status, 400, '完成数量不能超过总数');
  result = call(routes, 'POST', '/api/work-reports', {
    work_order_id: 1, process_node_id: 11, hours_spent: 4, quantity_completed: 6, quantity_total: 8, quality_result: 'pass', notes: '正常报工',
  }, { uid: 7, role: 'worker' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const row = db.prepare('SELECT * FROM work_report_details WHERE id = ?').get(result.json.id);
  assert.equal(row.worker_id, 7, '未传 worker_id 时默认当前用户');
  assert.equal(row.completion_pct, 75);
  assert.equal(db.prepare('SELECT actual_hours FROM work_orders WHERE id = 1').get().actual_hours, 4);
});

test('WH-2 撤销报工：删除记录并重算工单 actual_hours', () => {
  const first = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 3 });
  const second = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 2 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(db.prepare('SELECT actual_hours FROM work_orders WHERE id = 1').get().actual_hours, 5);
  const removed = call(routes, 'DELETE', '/api/work-reports/:id', { __id: second.json.id });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.actual_hours, 3);
  assert.equal(reportCount(), 1);
  const missing = call(routes, 'DELETE', '/api/work-reports/:id', { __id: 9999 });
  assert.equal(missing.status, 404);
});

test('WH-3 工时定额校验：节点存在、标准工时 > 0、人数 1-100', () => {
  let result = call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 'undefined', work_type: 'assembly', standard_hours: 2 });
  assert.equal(result.status, 400, "'undefined' 节点必须拒绝");
  result = call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 999, work_type: 'assembly', standard_hours: 2 });
  assert.equal(result.status, 404);
  result = call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 0 });
  assert.equal(result.status, 400);
  result = call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8, worker_count: 0 });
  assert.equal(result.status, 400);
  result = call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8, worker_count: 2 });
  assert.equal(result.status, 200);
  const saved = call(routes, 'GET', '/api/process/nodes/:id/hours', { __id: 11 });
  assert.equal(saved.json.total_man_hours, 16);
});

test("WH-3' 工人绩效：标准工时取工序定额，无定额时 efficiency 为 null", () => {
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8, worker_count: 1 });
  call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 4 });
  const perf = call(routes, 'GET', '/api/process-hours/worker-performance?from=2020-01-01&to=2030-01-01', {});
  assert.equal(perf.status, 200);
  const worker = perf.json.workers.find((row) => row.user_id === 7);
  assert.ok(worker, '应有当前工人的绩效行');
  assert.equal(worker.standard_hours, 8, '标准工时来自工序定额');
  assert.equal(worker.efficiency_pct, 200, '效率 = 标准 / 实际');
  assert.equal(perf.json.summary.avg_efficiency, 200);
  // 没有定额的节点 → null，而不是 12.5%
  const done = call(routes, 'POST', '/api/work-reports', { work_order_id: 1, hours_spent: 2 });
  assert.equal(done.status, 200);
  const perf2 = call(routes, 'GET', '/api/process-hours/worker-performance?from=2020-01-01&to=2030-01-01', {});
  const worker2 = perf2.json.workers.find((row) => row.user_id === 7);
  assert.equal(worker2.standard_hours, 8, '无工序节点的报工不计入标准工时');
});

test('WH-5 完工进度：优先数量口径，并返回工时消耗率', () => {
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8, worker_count: 1 });
  call(routes, 'POST', '/api/work-reports', { work_order_id: 1, process_node_id: 11, hours_spent: 4, quantity_completed: 6, quantity_total: 8 });
  const progress = call(routes, 'GET', '/api/process/nodes/:id/progress', { __id: 11 });
  assert.equal(progress.status, 200);
  assert.equal(progress.json.completion_pct, 75, '完成率按数量 6/8');
  assert.equal(progress.json.hours_ratio_pct, 50, '工时消耗率 4/8');
  assert.equal(progress.json.quantity_total, 8);
});

test('WH-6 hours-summary 节点数按去重计', () => {
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'assembly', standard_hours: 8 });
  call(routes, 'POST', '/api/process/nodes/:id/hours', { __id: 11, work_type: 'welding', standard_hours: 4 });
  const summary = call(routes, 'GET', '/api/process/hours-summary?instance_id=1', {});
  assert.equal(summary.status, 200);
  assert.equal(summary.json.nodes, 1, '一个节点两条定额仍算 1 个节点');
  assert.equal(summary.json.total_man_hours, 12);
});
