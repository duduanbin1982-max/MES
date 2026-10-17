'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const svcPath = path.resolve(__dirname, '../services/delayAlerts.js');
function makeDb() {
  const db = new Database(':memory:');
(s) => s;
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, status TEXT, planned_start TEXT, start_date TEXT)');
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, wo_code TEXT, title TEXT, planned_end TEXT, status TEXT DEFAULT pending)');
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, planned_end TEXT, status TEXT DEFAULT pending)');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT)');
  return db;
}
function makeApp() { const r = {}; for (const m of ['get','post','put','delete']) r[m] = (p, ...hs) => { r[m.toUpperCase() + ' ' + p] = hs; }; return r; }
function call(app, method, path) {
  const origPath = path;
  const pathTpl = path.replace(/\d+/g, ':id');
  const q = path.indexOf('?'); if (q >= 0) path = path.slice(0, q);
  let hs = app[method.toUpperCase() + ' ' + path];
  if (!hs) { hs = app[method.toUpperCase() + ' ' + pathTpl]; }
  if (!hs) throw new Error('no route: ' + method + ' ' + path);
  const params = {};
  const re1 = /:([a-zA-Z_]+)/g; let m;
  while ((m = re1.exec(pathTpl))) { const parts = path.split('/'); const idx = pathTpl.split('/').indexOf(':' + m[1]); if (idx >= 0 && parts[idx]) params[m[1]] = parts[idx]; }
  const qIdx = origPath.indexOf('?'); const qStr = qIdx >= 0 ? origPath.slice(qIdx + 1) : ''; const qObj = {}; for (const kv of qStr.split('&')) { if (kv) { const [k, v = ''] = kv.split('='); qObj[decodeURIComponent(k)] = decodeURIComponent(v); } } const req = { method, query: qObj, body: {}, params };
  let s = 200, b = null;
  const res = { status(c){s=c;return this}, json(x){b=x;return this} };
  for (const h of hs) h(req, res);
  return { status: s, body: b };
}
test('summary 0 项空表', () => {
  const db = makeDb(); const app = makeApp();
  delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/dashboard/delays/summary');
  assert.equal(r.status, 200); assert.equal(r.body.total, 0);
});
test('delays 排序 + 严重度', () => {
  const db = makeDb(); const Q = (s) => s;
  db.prepare('INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (?, ?, ?)').run(1, Q('T1'), Q('T1'));
  const past = (d) => new Date(Date.now() - d*24*3600*1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, wo_code, planned_end, status) VALUES (?, ?, ?, ?, ?)').run(1, 1, Q('WO1'), past(3), Q('in_progress'));
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, wo_code, planned_end, status) VALUES (?, ?, ?, ?, ?)').run(2, 1, Q('WO2'), past(10), Q('in_progress'));
  db.prepare('INSERT INTO work_orders (id, equipment_instance_id, wo_code, planned_end, status) VALUES (?, ?, ?, ?, ?)').run(3, 1, Q('WO3'), past(5), Q('completed'));
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/dashboard/delays');
  assert.equal(r.status, 200); assert.equal(r.body.total, 2);
  assert.equal(r.body.items[0].id, 2);
  assert.equal(r.body.items[1].id, 1);
  assert.equal(r.body.by_severity.high, 1);
  assert.equal(r.body.by_severity.critical, 1);
});
