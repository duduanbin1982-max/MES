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
  db.exec('CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, parent_id INTEGER, bom_node_id INTEGER, operation_name TEXT, operation_type TEXT DEFAULT make, sequence INTEGER DEFAULT 1, estimated_hours REAL DEFAULT 0, required_workstation_id INTEGER, status TEXT DEFAULT pending, planned_start TEXT, planned_end TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE process_dependencies (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, predecessor_id INTEGER, successor_id INTEGER, dep_type TEXT DEFAULT FS, lag_hours INTEGER DEFAULT 0)');
  db.exec('CREATE TABLE process_reschedule_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_no TEXT, shift_days INTEGER, instance_id INTEGER, subsystem_id INTEGER, only_overdue INTEGER, anchor_date TEXT, node_count INTEGER, items_json TEXT, note TEXT, undone_at TEXT, created_by INTEGER, created_at TEXT)');
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
call(app, 'post', '/api/equipment_instances/1/schedule');
  const total = db.prepare('SELECT id, planned_start, planned_end, required_workstation_id FROM process_nodes WHERE required_workstation_id=1 ORDER BY planned_start').all();
  assert.equal(total.length, 2);
  assert.ok(total[0].planned_end <= total[1].planned_start, '工位 1 的总装应先完成才到喷漆');
});


test('已完成节点不被重排（保护历史计划）', () => {
  const db = makeDb();
  db.prepare('UPDATE process_nodes SET status = ? WHERE id = 2').run('completed');
  db.prepare('UPDATE process_nodes SET planned_start = ?, planned_end = ? WHERE id = 2').run('2026-06-01 00:00:00', '2026-06-01 08:00:00');
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const r = call(app, 'post', '/api/equipment_instances/1/schedule');
  assert.equal(r.status, 200);
  assert.equal(r.body.protected_count, 1);
  assert.deepEqual(r.body.protected_nodes.map((n) => n.id), [2]);
  const row = db.prepare('SELECT planned_start, planned_end, status FROM process_nodes WHERE id = 2').get();
  assert.equal(row.planned_start, '2026-06-01 00:00:00', '已完成节点计划时间不变');
  assert.equal(row.status, 'completed');
});

test('dryRun 返回变更明细（旧 → 新）+ changed_count，且写库时记录批次', () => {
  const db = makeDb();
  const app = makeApp();
  delete require.cache[svcPath];
  require(svcPath).register(app, db);
  const dry = call(app, 'post', '/api/equipment_instances/1/schedule?dryRun=1', { dryRun: '1' });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.written_count, 0);
  assert.equal(dry.body.changed_count, 4);
  assert.equal(dry.body.full.length, 4);
  assert.equal(dry.body.full[0].previous_planned_start, null);
  assert.ok(dry.body.full[0].planned_start);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_reschedule_batches').get().c, 0, 'dryRun 不写批次');

  const real = call(app, 'post', '/api/equipment_instances/1/schedule');
  assert.equal(real.status, 200);
  assert.equal(real.body.written_count, 4);
  assert.match(String(real.body.batch_no), /^SC-\d{8}-\d{3}$/);
  const batch = db.prepare('SELECT * FROM process_reschedule_batches').get();
  assert.ok(real.body.batch_id, '返回 batch_id 供撤销');
  assert.equal(batch.node_count, 4);
  const items = JSON.parse(batch.items_json);
  assert.equal(items.length, 4);
  assert.equal(items[0].old_planned_start, null);
  assert.ok(items[0].new_planned_start);
});


test('equipment 模块装配了 scheduler（防 F-01 路由再次漏注册）', () => {
  const equipment = require('../services/equipment');
  assert.ok(Array.isArray(equipment.moduleNames), 'equipment 应导出 moduleNames');
  assert.ok(equipment.moduleNames.includes('scheduler'), 'moduleNames 必须包含 scheduler');
});
