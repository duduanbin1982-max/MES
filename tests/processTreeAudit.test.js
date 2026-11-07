'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const generator = require('../services/processTree/generator');
const processRouteService = require('../services/processRouteService');

function mkRes() {
  const result = { status: 200, body: null };
  result.status = (code) => { result.statusCode = code; return result; };
  result.json = (payload) => { result.body = payload; return result; };
  result._j = payload => payload;
  return result;
}

function captureApp() {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    put: (path, handler) => routes.set(`PUT ${path}`, handler),
    patch: (path, handler) => routes.set(`PATCH ${path}`, handler),
    delete: (path, handler) => routes.set(`DELETE ${path}`, handler),
  };
  return { app, routes };
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, parent_id INTEGER, tier INTEGER, part_number TEXT, material_id INTEGER, quantity REAL, unit TEXT, category TEXT, notes TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, station_type TEXT, workshop TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE process_operation_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, operation_code TEXT, operation_name TEXT NOT NULL, operation_type TEXT, category TEXT, default_station_type TEXT, required_skill TEXT, required_position_code TEXT, standard_hours REAL, worker_count INTEGER, qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0, sequence_hint INTEGER, description TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, parent_id INTEGER, bom_node_id INTEGER,
      operation_name TEXT NOT NULL, operation_type TEXT, sequence INTEGER, estimated_hours REAL,
      required_workstation_id INTEGER, required_skill TEXT, required_materials TEXT, is_milestone INTEGER DEFAULT 0,
      phase_code TEXT, status TEXT DEFAULT 'pending', planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      planned_cost REAL, actual_cost REAL, auto_unblock INTEGER, sort_order INTEGER, notes TEXT, created_at TEXT, updated_at TEXT,
      assigned_to INTEGER, subsystem_id INTEGER, operation_template_id INTEGER, required_position_code TEXT,
      worker_count INTEGER, qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0
    );
    CREATE TABLE process_standard_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, work_type TEXT, standard_hours REAL, worker_count INTEGER, unit TEXT, description TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT NOT NULL, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare("INSERT INTO equipment_instances VALUES (1, 'TBM-1', '一号机')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (10, 'M-1', '钢板')").run();
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, part_number, material_id, quantity, unit) VALUES (100, 1, NULL, 1, 'P-1', 10, 1, '件'), (101, 1, NULL, 1, 'P-2', 10, 1, '件')").run();
  db.prepare("INSERT INTO workstations (id, code, name, station_type, workshop, is_active) VALUES (1, 'WS-ASM', '装配工位', 'assembly', '装配车间', 1)").run();
  db.prepare(`INSERT INTO process_operation_templates
    (id, operation_code, operation_name, operation_type, default_station_type, required_skill, required_position_code, standard_hours, worker_count, qc_required, sop_required, drawing_required, sequence_hint, description, is_active)
    VALUES (1, 'OP-ASM', '装配准备', 'assembly', 'assembly', 'assembly', 'POS-ASM', 4, 2, 0, 1, 1, 1, '装配准备模板', 1),
           (2, 'OP-QC', '过程检验', 'qc', 'qc', 'qc', 'POS-QC', 2, 1, 1, 0, 1, 2, '检验模板', 1)`).run();
  return db;
}

test('PT.1 CPM 纳入 FS 依赖与 lag（同级节点不再平行）', () => {
  const nodes = [
    { id: 1, parent_id: null, duration_days: 10 },
    { id: 2, parent_id: null, duration_days: 5 },
  ];
  let result = generator.computeCPM(nodes);
  assert.equal(result.projectDuration, 10);
  const parallelB = result.allNodes.find(n => n.id === 2);
  assert.equal(parallelB.es, 0);
  assert.ok(parallelB.slack > 0);

  result = generator.computeCPM(nodes, [{ predecessor_id: 1, successor_id: 2, dep_type: 'FS', lag_hours: 2 }]);
  assert.equal(result.projectDuration, 17);
  const a = result.allNodes.find(n => n.id === 1);
  const b = result.allNodes.find(n => n.id === 2);
  assert.equal(b.es, 12);
  assert.equal(b.slack, 0);
  assert.equal(a.slack, 0);
  assert.deepEqual(result.criticalNodes.sort((x, y) => x - y), [1, 2]);
});

test('PT.2 CPM 支持 SS/FF/SF 语义', () => {
  const nodes = [
    { id: 1, parent_id: null, duration_days: 10 },
    { id: 2, parent_id: null, duration_days: 4 },
  ];
  const ss = generator.computeCPM(nodes, [{ predecessor_id: 1, successor_id: 2, dep_type: 'SS', lag_hours: 3 }]);
  assert.equal(ss.allNodes.find(n => n.id === 2).es, 3);

  const ff = generator.computeCPM(nodes, [{ predecessor_id: 1, successor_id: 2, dep_type: 'FF', lag_hours: 0 }]);
  assert.equal(ff.allNodes.find(n => n.id === 2).es, 6);

  const sf = generator.computeCPM(nodes, [{ predecessor_id: 1, successor_id: 2, dep_type: 'SF', lag_hours: 5 }]);
  assert.equal(sf.allNodes.find(n => n.id === 2).es, 1);
});

test('PT.3 依赖环被识别（不再只检查父子环）', () => {
  const nodes = [
    { id: 1, parent_id: null, duration_days: 1 },
    { id: 2, parent_id: null, duration_days: 1 },
  ];
  const result = generator.computeCPM(nodes, [
    { predecessor_id: 1, successor_id: 2, dep_type: 'FS', lag_hours: 0 },
    { predecessor_id: 2, successor_id: 1, dep_type: 'FS', lag_hours: 0 },
  ]);
  assert.ok(result.cycleNodes.includes(1) && result.cycleNodes.includes(2));
  const topo = generator.topoSort(nodes, [
    { predecessor_id: 1, successor_id: 2 },
    { predecessor_id: 2, successor_id: 1 },
  ]);
  assert.equal(topo.cycleNodes.length, 2);
});

test('PT.4 generate-missing 使用模板配置并创建标准工时，幂等', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  processRouteService.register(app, db);
  const handler = routes.get('POST /api/process-route/instances/:id/generate-missing');
  assert.ok(handler);

  let res = mkRes();
  await handler({ params: { id: 1 }, body: {}, user: { uid: 1, role: 'admin', permissions: ['*'] } }, res);
  assert.equal(res.body.created, 4, '2 个部件 × 2 道模板工序');
  assert.equal(res.body.created_hours, 4);
  const nodes = db.prepare('SELECT * FROM process_nodes ORDER BY bom_node_id, operation_name').all();
  assert.equal(nodes.length, 4);
  assert.ok(nodes.every(n => n.operation_template_id));
  assert.ok(nodes.some(n => n.operation_name === '过程检验' && n.qc_required === 1 && n.sop_required === 0 && n.drawing_required === 1));
  assert.ok(nodes.some(n => n.required_position_code === 'POS-ASM' && n.worker_count === 2));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_standard_hours').get().c, 4);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='process_route.generate_missing'").get().c, 1);

  res = mkRes();
  await handler({ params: { id: 1 }, body: {}, user: { uid: 1, role: 'admin', permissions: ['*'] } }, res);
  assert.equal(res.body.created, 0, '再次调用不应重复生成');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_nodes').get().c, 4);
  db.close();
});
