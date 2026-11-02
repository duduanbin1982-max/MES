'use strict';
// tests/dashboardRiskSummary.test.js
// 2026-11-02：仪表盘风险口径（延误已拆两档）
//   已开工超期 = in_progress/paused 且过计划完成时间  → 计入风险合计
//   未开工计划过期 = pending/ready 且计划时间已过     → 单列 backlog，不计入风险合计

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');

const svcPath = path.resolve(__dirname, '../services/reportService/dashboard.js');

function makeDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE equipment_types (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1, name_zh TEXT)');
  db.exec('CREATE TABLE equipment_models (id INTEGER PRIMARY KEY, equipment_type_id INTEGER)');
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT, lifecycle_stage TEXT, equipment_model_id INTEGER)');
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, planned_end TEXT, status TEXT DEFAULT pending)');
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, planned_end TEXT, status TEXT DEFAULT pending)');
  db.exec('CREATE TABLE instance_bom (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, lead_time_weeks INTEGER, supplier TEXT, unit_price REAL)');
  db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT)');
  db.exec('CREATE TABLE instance_eco (id INTEGER PRIMARY KEY, status TEXT)');
  db.exec('CREATE TABLE field_service (id INTEGER PRIMARY KEY, status TEXT)');
  return db;
}

function makeApp() {
  const routes = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    routes[method] = (routePath, ...handlers) => {
      routes[method.toUpperCase() + ' ' + routePath] = handlers;
    };
  }
  return routes;
}

function call(app, method, routePath) {
  const handlers = app[method.toUpperCase() + ' ' + routePath];
  if (!handlers) throw new Error('no route: ' + method + ' ' + routePath);
  const req = { method, query: {}, body: {}, params: {} };
  let status = 200;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  for (const handler of handlers) handler(req, res);
  return { status, body };
}

function past(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function seed(db) {
  db.prepare('INSERT INTO equipment_types (id, is_active, name_zh) VALUES (1, 1, ?)').run('盾构机/掘进机');
  db.prepare('INSERT INTO equipment_models (id, equipment_type_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO equipment_instances (id, instance_code, instance_name, status, lifecycle_stage, equipment_model_id) VALUES (1, ?, ?, ?, ?, 1)').run('T1', '测试机', 'design', 'design');
  // 已开工超期：in_progress 且计划结束已过
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, planned_end, status) VALUES (1, 1, ?, ?)').run(past(3), 'in_progress');
  // 未开工计划过期：pending 且计划结束已过
  db.prepare('INSERT INTO process_nodes (id, equipment_instance_id, planned_end, status) VALUES (1, 1, ?, ?)').run(past(2), 'pending');
  // 未超期：计划时间在未来 → 不计
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, planned_end, status) VALUES (2, 1, ?, ?)').run('2099-01-01 00:00:00', 'in_progress');
  // 长交期：16 周（同时算 12/16 两档）
  db.prepare('INSERT INTO key_components (id, material_id, lead_time_weeks, supplier, unit_price) VALUES (1, 1, 16, ?, 100)').run('供应商A');
  db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (1, ?, ?)').run('WG-001', '主轴承');
  // 8 周：两档都不算
  db.prepare('INSERT INTO key_components (id, material_id, lead_time_weeks, supplier, unit_price) VALUES (2, 1, 8, ?, 50)').run('供应商B');
  db.prepare('INSERT INTO instance_eco (id, status) VALUES (1, ?)').run('open');
  db.prepare('INSERT INTO field_service (id, status) VALUES (1, ?)').run('open');
}

test('dashboard risk summary：延误拆两档，风险合计只算执行风险', () => {
  const db = makeDb();
  seed(db);
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);

  const risk = call(app, 'get', '/api/dashboard/risk-summary');
  assert.equal(risk.status, 200);
  // 执行风险 = 已开工超期 1 + 长交期 1 + ECO 1 + 服务 1 = 4
  assert.equal(risk.body.total, 4);
  assert.equal(risk.body.level.type, 'warning');

  // 延误合计仍兼容旧语义（1 工单 + 1 工序）
  assert.equal(risk.body.delays.total, 2);
  assert.equal(risk.body.delays.work_order_delays, 1);
  assert.equal(risk.body.delays.process_node_delays, 1);

  // 新拆分字段
  assert.deepEqual(risk.body.delays.started, { work_orders: 1, process_nodes: 0, total: 1 });
  assert.deepEqual(risk.body.delays.not_started, { work_orders: 0, process_nodes: 1, total: 1 });
  assert.equal(risk.body.sources.delays_started, 1);
  assert.equal(risk.body.sources.delays_not_started, 1);
  assert.equal(risk.body.backlog.not_started, 1);

  // 长交期两档
  assert.equal(risk.body.sources.long_leadtime, 1);
  assert.equal(risk.body.sources.long_leadtime_urgent, 1);

  // 风险项拆成 5 条
  assert.deepEqual(risk.body.items.map((item) => item.key), [
    'delays_started', 'delays_not_started', 'long_leadtime', 'open_eco', 'open_field_service',
  ]);
  assert.equal(risk.body.items[0].value, 1);
  assert.equal(risk.body.items[1].value, 1);
});

test('dashboard 头部计数复用同一份风险口径，并返回 by_type', () => {
  const db = makeDb();
  seed(db);
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);

  const risk = call(app, 'get', '/api/dashboard/risk-summary');
  const dashboard = call(app, 'get', '/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.risk_summary.total, risk.body.total);
  assert.equal(dashboard.body.long_leadtime, 1);
  assert.equal(dashboard.body.open_eco, 1);
  // 装备类型分布（前端饼图依赖，之前接口没返回）
  assert.deepEqual(dashboard.body.instances.by_type, [{ type: '盾构机/掘进机', c: 1 }]);
  db.close();
});

test('长交期接口返回 is_urgent 标记（>=16 周）', () => {
  const db = makeDb();
  seed(db);
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const list = call(app, 'get', '/api/dashboard/long-leadtime');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1, '只有 16 周那条 >=12 周');
  assert.equal(list.body.items[0].is_urgent, 1);
  db.close();
});
