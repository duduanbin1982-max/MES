'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const svcPath = path.resolve(__dirname, '../services/equipment/multiInstanceScheduler.js');
function makeDb() {
  const db = new Database(':memory:');
  const Q = (s) => s;
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, status TEXT, planned_start TEXT, start_date TEXT)');
  db.exec('CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, workshop TEXT)');
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, parent_id INTEGER, bom_node_id INTEGER, operation_name TEXT, operation_type TEXT DEFAULT make, sequence INTEGER DEFAULT 1, estimated_hours REAL DEFAULT 0, required_workstation_id INTEGER, status TEXT DEFAULT pending, planned_start TEXT, planned_end TEXT)');
  db.exec('CREATE TABLE process_dependencies (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, predecessor_id INTEGER, successor_id INTEGER, dep_type TEXT DEFAULT FS, lag_hours INTEGER DEFAULT 0)');
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
test('global 0 数据', () => {
  const db = makeDb(); const app = makeApp();
  delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/schedule/global');
  assert.equal(r.status, 200); assert.equal(r.body.summary.instance_count, 0);
  assert.equal(r.body.summary.cross_conflict_count, 0);
});
test('跨实例冲突', () => {
  const db = makeDb(); const Q = (s) => s;
  db.prepare('INSERT INTO equipment_instances (id, instance_code, planned_start, status) VALUES (?, ?, ?, ?)').run(1, Q('T1'), Q('2026-07-01'), Q('in_progress'));
  db.prepare('INSERT INTO equipment_instances (id, instance_code, planned_start, status) VALUES (?, ?, ?, ?)').run(2, Q('T2'), Q('2026-07-03'), Q('in_progress'));
  db.prepare('INSERT INTO workstations (id, name) VALUES (?, ?)').run(1, Q('激光'));
  db.prepare('INSERT INTO process_nodes (id, equipment_instance_id, operation_name, estimated_hours, planned_start, planned_end, required_workstation_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 1, Q('切割'), 4, Q('2026-07-03 08:00:00'), Q('2026-07-03 12:00:00'), 1);
  db.prepare('INSERT INTO process_nodes (id, equipment_instance_id, operation_name, estimated_hours, planned_start, planned_end, required_workstation_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(2, 2, Q('切割'), 16, Q('2026-07-03 00:00:00'), Q('2026-07-03 16:00:00'), 1);
  const app = makeApp(); delete require.cache[svcPath]; require(svcPath).register(app, db);
  const r = call(app, 'get', '/api/schedule/global');
  assert.equal(r.status, 200); assert.equal(r.body.summary.instance_count, 2);
  assert.equal(r.body.summary.cross_conflict_count, 1);
  assert.equal(r.body.cross_instance_conflicts[0].workstation, '激光');
  assert.equal(r.body.cross_instance_conflicts[0].overlap_hours, 4);
});
