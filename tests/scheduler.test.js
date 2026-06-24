'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const svcPath = path.resolve(__dirname, '../services/equipment/scheduler');

function makeDb() {
  const db = new Database(':memory:');
  const Q = (s) => "'" + s + "'";
  db.exec('CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, customer_name TEXT, status TEXT, planned_start TEXT, start_date TEXT)');
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, parent_id INTEGER, bom_node_id INTEGER, operation_name TEXT, operation_type TEXT DEFAULT make, sequence INTEGER DEFAULT 1, estimated_hours REAL DEFAULT 0, required_workstation_id INTEGER, status TEXT DEFAULT pending, planned_start TEXT, planned_end TEXT)');
  db.exec('CREATE TABLE process_dependencies (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, predecessor_id INTEGER, successor_id INTEGER, dep_type TEXT DEFAULT FS, lag_hours INTEGER DEFAULT 0)');
  const ins = db.prepare('INSERT INTO equipment_instances (id, instance_code, instance_name, customer_name, status, planned_start, start_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run(1, Q('T1'), Q('T1'), Q('C1'), Q('in_progress'), Q('2026-07-01'), Q('2026-07-01'));
  const insPn = db.prepare('INSERT INTO process_nodes (id, equipment_instance_id, operation_name, sequence, estimated_hours, required_workstation_id) VALUES (?, ?, ?, ?, ?, ?)');
  insPn.run(1, 1, Q('切割'), 1, 4, null);
  insPn.run(2, 1, Q('焊接'), 2, 8, null);
  insPn.run(3, 1, Q('总装'), 3, 16, 1);
  insPn.run(4, 1, Q('喷漆'), 4, 4, 1);
  const insDep = db.prepare('INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id) VALUES (?, ?, ?)');
  insDep.run(1, 1, 2); insDep.run(1, 2, 3); insDep.run(1, 3, 4);
  return db;
}

function makeApp() { const r = {}; for (const m of ['get','post','put','delete']) r[m] = (p, ...hs) => { r[m.toUpperCase() + ' ' + p] = hs; }; return r; }

function call(app, method, path, query) {
  const q = path.indexOf('?'); if (q >= 0) path = path.slice(0, q);
  let hs = app[method.toUpperCase() + ' ' + path];
  if (!hs) { const alt = path.replace(/\/\d+/g, '/:id'); hs = app[method.toUpperCase() + ' ' + alt]; }
  if (!hs) throw new Error('no route: ' + method + ' ' + path);
  // extract :id from path like /api/.../1/... -> replace digits with :name
  const pathTpl = path.replace(/\d+/g, ':id');
  const params = {};
  const re1 = /:([a-zA-Z_]+)/g; let m;
  while ((m = re1.exec(pathTpl))) {
    const parts = path.split('/');
    const idx = pathTpl.split('/').indexOf(':' + m[1]);
    if (idx >= 0 && parts[idx]) params[m[1]] = parts[idx];
  }
  const req = { method, query: query || {}, body: {}, params };
  let s = 200, b = null;
  const res = { status(c){s=c;return this}, json(x){b=x;return this} };
  for (const h of hs) h(req, res);
  return { status: s, body: b };
}

test('POST /api/equipment_instances/:id/schedule 排程 4 节点', () => {
  const db = makeDb();
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const r = call(app, 'post', '/api/equipment_instances/1/schedule');
  assert.equal(r.status, 200);
  assert.equal(r.body.written_count, 4);
  assert.equal(r.body.errors.length, 0);
  const rows = db.prepare('SELECT id, planned_start, planned_end FROM process_nodes WHERE equipment_instance_id=1 ORDER BY id').all();
  assert.equal(rows[0].planned_end, '2026-07-01 04:00:00');
  assert.equal(rows[1].planned_start, '2026-07-01 04:00:00');
  assert.equal(rows[2].planned_start, '2026-07-01 12:00:00');
  assert.equal(rows[3].planned_start, '2026-07-02 04:00:00');
});

test('dryRun=1 不写回 DB', () => {
  const db = makeDb();
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const r = call(app, 'post', '/api/equipment_instances/1/schedule?dryRun=1', { dryRun: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.dry_run, true);
  assert.equal(r.body.written_count, 0);
  const stillNull = db.prepare('SELECT count(*) c FROM process_nodes WHERE planned_start IS NOT NULL').get().c;
  assert.equal(stillNull, 0);
});

test('环检测报 400', () => {
  const db = makeDb();
  db.prepare('INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id) VALUES (?, ?, ?)').run(1, 2, 1);
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const r = call(app, 'post', '/api/equipment_instances/1/schedule');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /cycle/);
});

test('工位冲突串行排', () => {
  const db = makeDb();
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const r = call(app, 'post', '/api/equipment_instances/1/schedule');
  const total = db.prepare('SELECT id, planned_start, planned_end, required_workstation_id FROM process_nodes WHERE required_workstation_id=1 ORDER BY planned_start').all();
  assert.equal(total.length, 2);
  assert.ok(total[0].planned_end <= total[1].planned_start, '工位 1 的总装应先完成才到喷漆');
});
