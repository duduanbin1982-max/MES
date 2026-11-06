'use strict';

/**
 * tests/auditInventorySpc.test.js
 * 2026-11-07 五模块审计（SPC 控制图 / 物料中心 / 单位换算 / 库存清单 / 库存预警）整改验证。
 *
 * 覆盖的真实缺陷：
 *   SPC-1  capability() 零方差返回 Infinity/NaN（写库后 spc_alerts.cpk 变 inf/空）
 *   SPC-2  wecoRules() sigma=0 时对平直数据误报"规则7 分层"
 *   SPC-3  GET /api/spc/alerts?limit=abc 直接 500
 *   SPC-4  PUT /api/spc/alerts/:id/ack 对不存在 id 返回 ok:true 且无审计
 *   SPC-5  前端依赖的 /api/spc/xbar-r、/api/spc/cpk、/api/spc/pareto 后端 404
 *   SPC-6  spcMonitor 告警去重：未确认告警每 5 分钟重复入库
 *   INV-1  库存流水 quantity 用 Math.abs 静默接受负数 / NaN
 *   INV-2  出库不校验库位状态（quarantined 也能出）
 *   INV-3  一键入库负数/NaN 直接产生负库存
 *   INV-4  拆批负数被 Math.abs 转正
 *   INV-5  合批字符串 id 可绕过"不能合到自身"
 *   UNI-1  换算 factor 负数/NaN 直接入库；返回 id 为 undefined
 *   UNI-2  重复换算规则 UNIQUE 约束 500；删除不存在返回 ok:true
 *   UNI-3  删除被批次/库存引用的换算规则（基础单位保护）
 *   ALR-1  库存预警忽略 reorder_point，且只配再订货点的物料被整体排除
 *   INV-4  库存清单缺 material_code（前端"编码"列空白）
 *   IMP-1  导入校验放过负库存/负价
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const engine = require('../app/spc/engine');
const spcService = require('../services/spcService');
const spcMonitor = require('../services/spcMonitor');
const material = require('../services/material');
const materialService = require('../services/materialService');

const ADMIN = { uid: 1, role: 'admin', permissions: ['*'] };

// ---------------------------------------------------------------- harness

function makeRoutes(db, registers) {
  const routes = {};
  const bind = (method) => (path, handler) => {
    routes[method.toUpperCase() + ' ' + path] = handler;
  };
  const app = {
    get: bind('get'),
    post: bind('post'),
    put: bind('put'),
    patch: bind('patch'),
    delete: bind('delete'),
  };
  for (const register of registers) register(app, db);
  return routes;
}

function callRoute(routes, method, path, options = {}) {
  const handler = routes[method + ' ' + path];
  assert.ok(handler, 'route not registered: ' + method + ' ' + path);
  const req = {
    body: options.body || {},
    query: options.query || {},
    params: options.params || {},
    user: options.user || ADMIN,
    ip: '127.0.0.1',
    headers: {},
    id: 'test-req',
  };
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return res; },
    json(data) { payload = data; return res; },
    type() { return res; },
    send(data) { payload = data; return res; },
  };
  let failure = null;
  handler(req, res, (error) => { failure = error || null; });
  if (failure) {
    status = failure.status || 500;
    payload = { code: failure.code || 'INTERNAL_ERROR', message: failure.message };
  }
  return { status, payload };
}

const AUDIT_DDL = `CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT,
  action TEXT, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT,
  diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT, error TEXT,
  created_at TEXT DEFAULT (datetime('now')))`;

// ---------------------------------------------------------------- SPC db

function freshSpcDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, operation_name TEXT, equipment_instance_id INTEGER)`);
  db.exec(`CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT)`);
  db.exec(`CREATE TABLE process_params (
    id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, recorded_by INTEGER,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    current_amp REAL, voltage_v REAL, speed_mm_min REAL, temperature_c REAL,
    pressure_mpa REAL, feed_rate REAL, custom_json TEXT, notes TEXT)`);
  db.exec(`CREATE TABLE spc_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, param TEXT, rule_desc TEXT,
    cpk REAL, node_name TEXT, acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE qc_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, work_order_id INTEGER,
    inspection_type TEXT NOT NULL, result TEXT NOT NULL, inspector_id INTEGER,
    inspection_date TEXT NOT NULL DEFAULT (datetime('now')), notes TEXT, serial_id INTEGER)`);
  db.exec(AUDIT_DDL);
  db.prepare('INSERT INTO equipment_instances (id, instance_code) VALUES (1, ?)').run('TBM-001');
  db.prepare('INSERT INTO process_nodes (id, operation_name, equipment_instance_id) VALUES (1, ?, 1)').run('总装');
  return db;
}

function seedParamSeries(db, nodeId, values, spec) {
  // recorded_at 必须严格递增, 否则 ORDER BY recorded_at 的顺序不稳定
  const insert = db.prepare("INSERT INTO process_params (process_node_id, recorded_at, current_amp, custom_json) VALUES (?, datetime('2026-11-01 00:00:00', ?), ?, ?)");
  for (let index = 0; index < values.length; index += 1) {
    insert.run(nodeId, '+' + index + ' minutes', values[index], spec ? JSON.stringify({ spc: { current_amp: spec } }) : null);
  }
}

function spcSetup() {
  const db = freshSpcDb();
  const routes = makeRoutes(db, [spcService.register]);
  return { db, routes };
}

// ---------------------------------------------------------------- material db

function freshMaterialDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL,
    material_type TEXT, spec TEXT, unit TEXT DEFAULT 'pcs', is_key_component INTEGER DEFAULT 0,
    is_self_made INTEGER DEFAULT 0, default_supplier TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    safety_stock REAL NOT NULL DEFAULT 0, reorder_point REAL NOT NULL DEFAULT 0,
    estimated_unit_price REAL NOT NULL DEFAULT 0, actual_unit_price REAL NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE material_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT NOT NULL,
    supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT,
    quality_status TEXT DEFAULT 'pending', notes TEXT)`);
  db.exec(`CREATE TABLE inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, location TEXT NOT NULL,
    quantity REAL NOT NULL, unit TEXT, status TEXT DEFAULT 'available',
    last_updated TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE material_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL,
    quantity REAL NOT NULL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER,
    project_id INTEGER, operator_id INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE material_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL, factor REAL NOT NULL, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (material_id, from_unit, to_unit))`);
  db.exec('CREATE TABLE work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, wo_code TEXT)');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  db.exec(AUDIT_DDL);
  db.prepare('INSERT INTO work_orders (id, wo_code) VALUES (1, ?)').run('WO-001');
  db.prepare('INSERT INTO materials (id, material_code, material_name, unit, safety_stock, reorder_point) VALUES (1, ?, ?, ?, 10, 20)').run('M-PLATE', '钢板', 'kg');
  db.prepare('INSERT INTO materials (id, material_code, material_name, unit) VALUES (2, ?, ?, ?)').run('M-BOLT', '螺栓', '件');
  db.prepare('INSERT INTO materials (id, material_code, material_name, unit, safety_stock, reorder_point) VALUES (3, ?, ?, ?, 0, 100)').run('M-ONLY-ROP', '只有再订货点', '件');
  db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, quality_status) VALUES (1, 1, ?, 5, ?, ?)').run('LOT-1', 'kg', 'passed');
  db.prepare('INSERT INTO inventory (id, material_lot_id, location, quantity, unit, status) VALUES (1, 1, ?, 5, ?, ?)').run('主仓库-A-01', 'kg', 'available');
  db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity, unit, quality_status) VALUES (3, 3, ?, 50, ?, ?)').run('LOT-ROP', '件', 'passed');
  db.prepare('INSERT INTO inventory (id, material_lot_id, location, quantity, unit, status) VALUES (3, 3, ?, 50, ?, ?)').run('主仓库-A-02', '件', 'available');
  return db;
}

function materialSetup() {
  const db = freshMaterialDb();
  const routes = makeRoutes(db, [material.register, materialService.register]);
  return { db, routes };
}

function auditActions(db) {
  return db.prepare('SELECT action FROM audit_logs ORDER BY id').all().map((row) => row.action);
}

// ---------------------------------------------------------------- SPC

test('SPC 引擎: 零方差不再返回 Infinity/NaN, 也不误报 WECO', () => {
  const flat = engine.capability([5, 5, 5, 5, 5], 6, 4);
  assert.equal(flat.sigma_within, 0);
  assert.equal(flat.sigma_overall, 0);
  assert.equal(flat.cpk, null);
  assert.match(flat.grade, /零方差/);

  const flatGroups = Array.from({ length: 20 }, () => ({ values: [5, 5, 5], mean: 5, range: 0 }));
  assert.deepEqual(engine.wecoRules(flatGroups), [], '平直数据不应触发规则7(分层)');

  const normal = engine.capability([9.8, 10.1, 10.0, 9.9, 10.2], 11, 9);
  assert.ok(Number.isFinite(normal.cpk) && normal.cpk > 0);
});

test('SPC analyze: subgroup_size 非法值 400, 合法值返回控制限', () => {
  const { db, routes } = spcSetup();
  seedParamSeries(db, 1, Array.from({ length: 30 }, (_v, index) => 50 + (index % 5) * 0.2));

  const bad = callRoute(routes, 'GET', '/api/spc/analyze', { query: { process_node_id: 1, param: 'current_amp', subgroup_size: '99' } });
  assert.equal(bad.status, 400);

  const badParam = callRoute(routes, 'GET', '/api/spc/analyze', { query: { process_node_id: 1, param: 'nope' } });
  assert.equal(badParam.status, 400);

  const ok = callRoute(routes, 'GET', '/api/spc/analyze', { query: { process_node_id: 1, param: 'current_amp', subgroup_size: '5' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.subgroup_count, 6);
  assert.ok(ok.payload.xbar.ucl > ok.payload.xbar.cl);
  assert.ok(ok.payload.xbar.cl > ok.payload.xbar.lcl);
});

test('SPC alerts: limit/acknowledged 非法值 400 (原来 500)', () => {
  const { routes } = spcSetup();
  assert.equal(callRoute(routes, 'GET', '/api/spc/alerts', { query: { limit: 'abc' } }).status, 400);
  assert.equal(callRoute(routes, 'GET', '/api/spc/alerts', { query: { limit: '100000' } }).status, 400);
  assert.equal(callRoute(routes, 'GET', '/api/spc/alerts', { query: { acknowledged: 'abc' } }).status, 400);
  assert.equal(callRoute(routes, 'GET', '/api/spc/alerts', { query: {} }).status, 200);
});

test('SPC ack: 不存在 404, 首次确认写审计, 重复确认不改数据', () => {
  const { db, routes } = spcSetup();
  db.prepare('INSERT INTO spc_alerts (id, process_node_id, param, rule_desc, cpk, node_name) VALUES (1, 1, ?, ?, 1.2, ?)')
    .run('current_amp', '连续 9 点在同一侧', '总装');

  const missing = callRoute(routes, 'PUT', '/api/spc/alerts/:id/ack', { params: { id: '999' } });
  assert.equal(missing.status, 404);

  const first = callRoute(routes, 'PUT', '/api/spc/alerts/:id/ack', { params: { id: '1' } });
  assert.equal(first.status, 200);
  assert.equal(first.payload.changed, true);
  assert.equal(db.prepare('SELECT acknowledged FROM spc_alerts WHERE id = 1').get().acknowledged, 1);
  assert.ok(auditActions(db).includes('spc.alert.ack'));

  const again = callRoute(routes, 'PUT', '/api/spc/alerts/:id/ack', { params: { id: '1' } });
  assert.equal(again.payload.changed, false);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'spc.alert.ack'").get().c, 1);
});

test('SPC xbar-r: 补齐前端端点并返回 CL/UCL/LCL 与失控点', () => {
  const { routes } = spcSetup();
  const ok = callRoute(routes, 'POST', '/api/spc/xbar-r', {
    body: { subgroups: [[50, 50.2, 49.9], [50.1, 50.3, 50.0], [49.8, 50.1, 50.2]], usl: 51, lsl: 49 },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.count, 3);
  assert.equal(ok.payload.subgroups.length, 3);
  assert.ok(ok.payload.ucl > ok.payload.cl && ok.payload.cl > ok.payload.lcl);
  assert.equal(typeof ok.payload.subgroups[0].out_of_control, 'boolean');

  assert.equal(callRoute(routes, 'POST', '/api/spc/xbar-r', { body: { subgroups: [[50]] } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/spc/xbar-r', { body: { subgroups: [] } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/spc/xbar-r', { body: { subgroups: [[1, 2], [3, 4]], usl: 1, lsl: 2 } }).status, 400);
});

test('SPC cpk: 返回直方图; 零方差 cpk 为 null', () => {
  const { routes } = spcSetup();
  const values = [9.8, 10.1, 10.0, 9.9, 10.2, 9.95, 10.05, 9.85, 10.15, 10.0];
  const ok = callRoute(routes, 'POST', '/api/spc/cpk', { body: { measurements: values, usl: 11, lsl: 9 } });
  assert.equal(ok.status, 200);
  assert.ok(Number.isFinite(ok.payload.cpk));
  assert.equal(ok.payload.histogram.bins.length, 10);
  assert.equal(ok.payload.histogram.counts.reduce((sum, count) => sum + count, 0), values.length);

  const flat = callRoute(routes, 'POST', '/api/spc/cpk', { body: { measurements: [5, 5, 5], usl: 6, lsl: 4 } });
  assert.equal(flat.status, 200);
  assert.equal(flat.payload.cpk, null);

  assert.equal(callRoute(routes, 'POST', '/api/spc/cpk', { body: { measurements: [1, 2, 3] } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/spc/cpk', { body: { measurements: [1, 'x'], usl: 5 } }).status, 400);
});

test('SPC pareto: 按缺陷描述分类并累计百分比, 非法 days 400', () => {
  const { db, routes } = spcSetup();
  db.prepare('INSERT INTO qc_inspections (equipment_instance_id, inspection_type, result, inspection_date, notes) VALUES (1, ?, ?, datetime(\'now\'), ?)')
    .run('in_process', 'fail', JSON.stringify({ defect_desc: '厚度超差' }));
  db.prepare('INSERT INTO qc_inspections (equipment_instance_id, inspection_type, result, inspection_date, notes) VALUES (1, ?, ?, datetime(\'now\'), ?)')
    .run('in_process', 'fail', JSON.stringify({ defect_desc: '厚度超差' }));
  db.prepare('INSERT INTO qc_inspections (equipment_instance_id, inspection_type, result, inspection_date, notes) VALUES (1, ?, ?, datetime(\'now\'), ?)')
    .run('final', 'pass', null);

  const ok = callRoute(routes, 'GET', '/api/spc/pareto', { query: { equipment_instance_id: 1, days: 30 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.total, 2);
  assert.equal(ok.payload.categories[0], '厚度超差');
  assert.equal(ok.payload.cumulative_pct[0], 100);

  assert.equal(callRoute(routes, 'GET', '/api/spc/pareto', { query: { equipment_instance_id: 1, days: '-1' } }).status, 400);
  assert.equal(callRoute(routes, 'GET', '/api/spc/pareto', { query: {} }).status, 400);
});

test('SPC 监控: 未确认的同一告警不重复入库', () => {
  const { db } = spcSetup();
  const values = [];
  for (let index = 0; index < 45; index += 1) values.push(49);
  for (let index = 0; index < 5; index += 1) values.push(51);
  seedParamSeries(db, 1, values);

  const node = { id: 1, operation_name: '总装', equipment_instance_id: 1 };
  spcMonitor.analyzeNode(db, node);
  const firstCount = db.prepare('SELECT COUNT(*) c FROM spc_alerts').get().c;
  assert.ok(firstCount > 0, '构造的数据应触发 WECO 告警');
  spcMonitor.analyzeNode(db, node);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM spc_alerts').get().c, firstCount);
});

// ---------------------------------------------------------------- 物料中心 / 库存

test('入库: 负数/0/NaN/单位不符 400; 合法入库写批次+库存+流水+审计', () => {
  const { db, routes } = materialSetup();
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/receive', { body: { material_id: 1, lot_no: 'L-NEG', quantity: -5 } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/receive', { body: { material_id: 1, lot_no: 'L-ZERO', quantity: 0 } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/receive', { body: { material_id: 1, lot_no: 'L-NAN', quantity: 'abc' } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/receive', { body: { material_id: 1, lot_no: 'L-UNIT', quantity: 1, unit: '吨' } }).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_lots WHERE lot_no IN (?,?,?,?)').get('L-NEG', 'L-ZERO', 'L-NAN', 'L-UNIT').c, 0);

  const ok = callRoute(routes, 'POST', '/api/material_lots/receive', { body: { material_id: 1, lot_no: 'L-OK', quantity: 3, unit: 'kg' } });
  assert.equal(ok.status, 200);
  assert.ok(Number.isInteger(ok.payload.id));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM inventory WHERE material_lot_id = ?').get(ok.payload.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_movements WHERE material_lot_id = ?').get(ok.payload.id).c, 1);
  assert.ok(auditActions(db).includes('material_lot.receive'));
});

test('拆批/合批: 负数拒绝, 字符串 id 不能绕过自身合并, 不同物料不能合', () => {
  const { db, routes } = materialSetup();
  db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity, unit) VALUES (2, 1, ?, 1, ?)').run('LOT-2', 'kg');
  db.prepare('INSERT INTO inventory (id, material_lot_id, location, quantity, unit) VALUES (2, 2, ?, 1, ?)').run('主仓库-A-01', 'kg');
  db.prepare('INSERT INTO material_lots (id, material_id, lot_no, quantity, unit) VALUES (4, 2, ?, 1, ?)').run('LOT-OTHER', '件');
  db.prepare('INSERT INTO inventory (id, material_lot_id, location, quantity, unit) VALUES (4, 4, ?, 1, ?)').run('主仓库-A-01', '件');

  assert.equal(callRoute(routes, 'POST', '/api/material_lots/:id/split', { params: { id: '1' }, body: { quantity: -2, new_lot_no: 'LOT-S' } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/:id/split', { params: { id: '1' }, body: { quantity: 'abc', new_lot_no: 'LOT-S' } }).status, 400);

  const split = callRoute(routes, 'POST', '/api/material_lots/:id/split', { params: { id: '1' }, body: { quantity: 2, new_lot_no: 'LOT-S' } });
  assert.equal(split.status, 200);
  assert.equal(db.prepare('SELECT SUM(quantity) q FROM inventory WHERE material_lot_id IN (1, ?)').get(split.payload.new_lot_id).q, 5);

  // 字符串 id 不能被 includes 绕过
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/:id/merge', { params: { id: '2' }, body: { source_lot_ids: ['2'] } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/:id/merge', { params: { id: '2' }, body: { source_lot_ids: [4] } }).status, 400);
  assert.equal(callRoute(routes, 'POST', '/api/material_lots/:id/merge', { params: { id: '2' }, body: { source_lot_ids: [999] } }).status, 404);

  const merged = callRoute(routes, 'POST', '/api/material_lots/:id/merge', { params: { id: '1' }, body: { source_lot_ids: [2] } });
  assert.equal(merged.status, 200);
  // 拆批后 lot1=3, 合入 lot2 的 1 → 4
  assert.equal(db.prepare('SELECT quantity FROM inventory WHERE material_lot_id = 1').get().quantity, 4);
});

test('库存流水: 0/负数/NaN 拒绝且回滚, 超发拒绝, 隔离库存不能出库', () => {
  const { db, routes } = materialSetup();
  for (const quantity of [0, -3, 'abc']) {
    const bad = callRoute(routes, 'POST', '/api/material_movements', { body: { material_lot_id: 1, movement_type: 'issue', quantity } });
    assert.equal(bad.status, 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_movements').get().c, 0);
  assert.equal(db.prepare('SELECT quantity FROM inventory WHERE id = 1').get().quantity, 5);

  const over = callRoute(routes, 'POST', '/api/material_movements', { body: { material_lot_id: 1, movement_type: 'issue', quantity: 999 } });
  assert.equal(over.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_movements').get().c, 0, '超发失败必须回滚流水');

  const ok = callRoute(routes, 'POST', '/api/material_movements', { body: { material_lot_id: 1, movement_type: 'issue', quantity: 2 } });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare('SELECT quantity FROM inventory WHERE id = 1').get().quantity, 3);
  assert.ok(auditActions(db).includes('inventory.movement.create'));

  db.prepare('UPDATE inventory SET status = ? WHERE id = 1').run('quarantined');
  const blocked = callRoute(routes, 'POST', '/api/material_movements', { body: { material_lot_id: 1, movement_type: 'issue', quantity: 1 } });
  assert.equal(blocked.status, 400);
});

test('预留/释放: 不能释放别的工单的预留', () => {
  const { db, routes } = materialSetup();
  const allocated = callRoute(routes, 'POST', '/api/inventory/allocate', { body: { material_lot_id: 1, work_order_id: 1, quantity: 2 } });
  assert.equal(allocated.status, 200);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE material_lot_id = 1 AND status = 'allocated'").get().quantity, 2);

  const wrongWorkOrder = callRoute(routes, 'POST', '/api/inventory/release', { body: { material_lot_id: 1, work_order_id: 2, quantity: 2 } });
  assert.equal(wrongWorkOrder.status, 400, '不能释放其它工单的预留');

  const released = callRoute(routes, 'POST', '/api/inventory/release', { body: { material_lot_id: 1, work_order_id: 1, quantity: 2 } });
  assert.equal(released.status, 200);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE material_lot_id = 1 AND status = 'available'").get().quantity, 5);
  assert.ok(auditActions(db).includes('inventory.allocate'));
  assert.ok(auditActions(db).includes('inventory.release'));
});

test('单位换算: 因子必须 >0 且有限, 重复 409, 删除 404/引用保护', () => {
  const { db, routes } = materialSetup();
  for (const factor of [0, -2, 'abc']) {
    const bad = callRoute(routes, 'POST', '/api/material_units', { body: { material_id: 2, from_unit: '箱', to_unit: '件', factor } });
    assert.equal(bad.status, 400);
  }
  assert.equal(callRoute(routes, 'POST', '/api/material_units', { body: { material_id: 1, from_unit: 'kg', to_unit: 'kg', factor: 1 } }).status, 400);

  const created = callRoute(routes, 'POST', '/api/material_units', { body: { material_id: 2, from_unit: '箱', to_unit: '件', factor: 100 } });
  assert.equal(created.status, 200);
  assert.ok(Number.isInteger(created.payload.id));

  assert.equal(callRoute(routes, 'POST', '/api/material_units', { body: { material_id: 2, from_unit: '箱', to_unit: '件', factor: 100 } }).status, 409);

  const list = callRoute(routes, 'GET', '/api/materials/:id/units', { params: { id: '2' } });
  assert.equal(list.status, 200);
  assert.equal(list.payload.items.length, 1);
  assert.equal(list.payload.base_unit, '件');
  assert.equal(callRoute(routes, 'GET', '/api/materials/:id/units', { params: { id: '999' } }).status, 404);

  assert.equal(callRoute(routes, 'DELETE', '/api/material_units/:id', { params: { id: '999' } }).status, 404);

  // kg 是物料 1 的基准单位且被批次/库存使用 → 删除被引用规则必须 409
  const baseRule = callRoute(routes, 'POST', '/api/material_units', { body: { material_id: 1, from_unit: '袋', to_unit: 'kg', factor: 25 } });
  assert.equal(baseRule.status, 200);
  assert.equal(callRoute(routes, 'DELETE', '/api/material_units/:id', { params: { id: String(baseRule.payload.id) } }).status, 409);

  // 未被引用的规则可删除
  assert.equal(callRoute(routes, 'DELETE', '/api/material_units/:id', { params: { id: String(created.payload.id) } }).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM material_units WHERE id = ?').get(created.payload.id).c, 0);
  assert.ok(auditActions(db).includes('material_unit.create'));
  assert.ok(auditActions(db).includes('material_unit.delete'));
});

test('库存预警: 以 max(安全库存, 再订货点) 为触发线并给出缺口', () => {
  const { routes } = materialSetup();
  const res = callRoute(routes, 'GET', '/api/inventory/alerts');
  assert.equal(res.status, 200);

  const byCode = {};
  for (const item of res.payload.items) byCode[item.material_code] = item;

  // 有安全库存 10 / 再订货点 20, 可用 5 → 触发线取 20, 缺口 15
  assert.equal(byCode['M-PLATE'].threshold, 20);
  assert.equal(byCode['M-PLATE'].shortage_qty, 15);
  // 只配了再订货点 100 的物料也要预警 (原实现 WHERE safety_stock > 0 会整体排除)
  assert.equal(byCode['M-ONLY-ROP'].threshold, 100);
  assert.equal(byCode['M-ONLY-ROP'].shortage_qty, 50);
  // 没配任何阈值的不出现
  assert.equal(byCode['M-BOLT'], undefined);
});

test('库存清单: 返回 material_code, 停滞天数非法值 400', () => {
  const { routes } = materialSetup();
  const list = callRoute(routes, 'GET', '/api/inventory');
  assert.equal(list.status, 200);
  assert.ok(list.payload.length >= 2);
  assert.equal(list.payload[0].material_code, 'M-ONLY-ROP');
  assert.equal(callRoute(routes, 'GET', '/api/inventory/stagnant', { query: { days: '-5' } }).status, 400);
  assert.equal(callRoute(routes, 'GET', '/api/inventory/stagnant', { query: { days: '30' } }).status, 200);
});

test('交期维护: 需要 material:write, 天数必须是 1..3650 整数', () => {
  const materialPlanner = require('../services/materialPlanner');
  const db = freshMaterialDb();
  const routes = makeRoutes(db, [materialPlanner.register]);

  const denied = callRoute(routes, 'POST', '/api/material-planner/lead-times', {
    user: { uid: 9, role: 'welder', permissions: ['work_order:read'] },
    body: { material_id: 1, lead_time_days: 30 },
  });
  assert.equal(denied.status, 403);

  const badDays = callRoute(routes, 'POST', '/api/material-planner/lead-times', { body: { material_id: 1, lead_time_days: -3 } });
  assert.equal(badDays.status, 400);

  const ok = callRoute(routes, 'POST', '/api/material-planner/lead-times', { body: { material_id: 1, lead_time_days: 30, supplier: '宝钢' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.lead_time_days, 30);
});

test('权限门: SPC 告警确认与单位换算写接口必须持权限', () => {
  const { apiPermissionMiddleware } = require('../middleware/apiPermissions');
  const gate = (path, method, permissions, role) => {
    let error = 'not-called';
    apiPermissionMiddleware({ path, method, originalUrl: '/api' + path, user: { role, permissions } }, {}, (err) => { error = err || null; });
    return error;
  };
  // 无权限用户必须被拦 (规则存在即 403)
  const deniedAck = gate('/spc/alerts/1/ack', 'PUT', [], 'viewer');
  assert.equal(deniedAck && deniedAck.status, 403);
  const deniedUnit = gate('/material_units', 'POST', ['material:read'], 'viewer');
  assert.equal(deniedUnit && deniedUnit.status, 403);
  // 有权限用户放行
  assert.equal(gate('/spc/alerts/1/ack', 'PUT', ['quality:write'], 'qc'), null);
  assert.equal(gate('/material_units', 'POST', ['material:write'], 'warehouse'), null);
});

test('导入: 负库存/负价校验, 全量事务提交并写审计', () => {
  const { db, routes } = materialSetup();
  const invalid = callRoute(routes, 'POST', '/api/materials/import/validate', {
    body: { rows: [{ material_code: 'WG-9001', material_name: '负值物料', material_type: 'purchased', unit: '件', safety_stock: '-5' }] },
  });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.payload.items[0].valid, false);
  assert.ok(invalid.payload.items[0].errors.some((message) => message.includes('安全库存')));

  const commitBad = callRoute(routes, 'POST', '/api/materials/import/commit', {
    body: { rows: [{ material_code: 'WG-9002', material_name: '负价物料', material_type: 'purchased', unit: '件', estimated_unit_price: '-1' }] },
  });
  assert.equal(commitBad.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM materials WHERE material_code = ?').get('WG-9002').c, 0);

  const ok = callRoute(routes, 'POST', '/api/materials/import/commit', {
    body: { rows: [{ material_code: 'WG-9003', material_name: '正常物料', material_type: 'purchased', unit: '件', safety_stock: '5' }] },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload));
  assert.equal(ok.payload.created, 1);
  assert.ok(auditActions(db).includes('material.import.commit'));
});
