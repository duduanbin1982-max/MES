'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');

const svcPath = path.resolve(__dirname, '../services/reportService/dashboard.js');

function makeDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE equipment_types (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1)');
  db.exec('CREATE TABLE equipment_models (id INTEGER PRIMARY KEY)');
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT, lifecycle_stage TEXT)');
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

test('dashboard risk summary uses one backend risk口径', () => {
  const db = makeDb();
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, planned_end, status) VALUES (?, ?, ?, ?)').run(1, 1, past(3), 'in_progress');
  db.prepare('INSERT INTO process_nodes (id, equipment_instance_id, planned_end, status) VALUES (?, ?, ?, ?)').run(1, 1, past(2), 'pending');
  db.prepare('INSERT INTO key_components (id, material_id, lead_time_weeks, supplier, unit_price) VALUES (?, ?, ?, ?, ?)').run(1, 1, 16, '供应商A', 100);
  db.prepare('INSERT INTO materials (id, material_code, material_name) VALUES (?, ?, ?)').run(1, 'WG-001', '主轴承');
  db.prepare('INSERT INTO instance_eco (id, status) VALUES (?, ?)').run(1, 'open');
  db.prepare('INSERT INTO field_service (id, status) VALUES (?, ?)').run(1, 'open');

  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);

  const risk = call(app, 'get', '/api/dashboard/risk-summary');
  assert.equal(risk.status, 200);
  assert.equal(risk.body.total, 5);
  assert.equal(risk.body.level.type, 'warning');
  assert.equal(risk.body.delays.total, 2);
  assert.deepEqual(risk.body.items.map((item) => item.key), ['delays', 'long_leadtime', 'open_eco', 'open_field_service']);

  const dashboard = call(app, 'get', '/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.risk_summary.total, risk.body.total);
  assert.equal(dashboard.body.long_leadtime, 1);
});
