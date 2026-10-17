'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const svcPath = path.resolve(__dirname, '../services/equipment/oee.js');
function makeDb() {
  const db = new Database(':memory:');
(s) => "'" + s + "'";
  db.exec('CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, workshop TEXT)');
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT)');
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, estimated_hours REAL DEFAULT 0, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT, required_workstation_id INTEGER)');
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
test('7 工位 0 任务 fleet 0%', () => {
  const db = makeDb(); const Q = (s) => "'" + s + "'";
  for (let i = 1; i <= 7; i++) db.prepare('INSERT INTO workstations (id, name) VALUES (?, ?)').run(i, Q('WS' + i));
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/equipment/oee?days=7');
  assert.equal(r.status, 200); assert.equal(r.body.summary.workstation_count, 7);
  assert.equal(r.body.summary.fleet_available_hours, 7*7*24);
});
test('工位 busy 算 util', () => {
  const db = makeDb(); const Q = (s) => "'" + s + "'";
  db.prepare('INSERT INTO workstations (id, name) VALUES (?, ?)').run(1, Q('激光'));
  db.prepare('INSERT INTO equipment_instances (id, instance_code) VALUES (?, ?)').run(1, Q('T1'));
  db.prepare('INSERT INTO process_nodes (equipment_instance_id, operation_name, estimated_hours, planned_start, planned_end, required_workstation_id) VALUES (?, ?, ?, ?, ?, ?)').run(1, Q('切割'), 4, '2026-07-01', '2026-07-01 04:00:00', 1);
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/equipment/oee?start_date=2026-07-01&days=2');
  assert.equal(r.body.workstations[0].busy_hours, 4);
  assert.ok(r.body.workstations[0].utilization_pct > 0);
});
