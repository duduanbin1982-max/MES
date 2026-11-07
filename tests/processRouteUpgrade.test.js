'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const processRouteService = require('../services/processRouteService');
const execution = require('../services/processRoute/execution');
const { ensureProcessRouteSchema } = require('../services/processRoute/schema');

function mkRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function captureApp() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler);
  }
  return { app, routes };
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_grade TEXT);
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, parent_id INTEGER, tier INTEGER,
      material_id INTEGER, part_number TEXT, quantity REAL, unit TEXT, category TEXT, material_grade TEXT,
      is_key_component INTEGER DEFAULT 0, is_phantom INTEGER DEFAULT 0, notes TEXT
    );
    CREATE TABLE workstations (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, station_type TEXT, workshop TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE process_operation_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, operation_code TEXT, operation_name TEXT, operation_type TEXT, category TEXT,
      default_station_type TEXT, required_skill TEXT, required_position_code TEXT, standard_hours REAL, worker_count INTEGER,
      qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0, sequence_hint INTEGER,
      description TEXT, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER NOT NULL, parent_id INTEGER, bom_node_id INTEGER,
      operation_name TEXT NOT NULL, operation_type TEXT, sequence INTEGER, estimated_hours REAL, required_workstation_id INTEGER,
      required_skill TEXT, required_materials TEXT, is_milestone INTEGER DEFAULT 0, phase_code TEXT, status TEXT DEFAULT 'pending',
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, planned_cost REAL, actual_cost REAL,
      auto_unblock INTEGER, sort_order INTEGER, notes TEXT, created_at TEXT, updated_at TEXT, assigned_to INTEGER,
      subsystem_id INTEGER, operation_template_id INTEGER, required_position_code TEXT, worker_count INTEGER,
      qc_required INTEGER DEFAULT 0, sop_required INTEGER DEFAULT 0, drawing_required INTEGER DEFAULT 0,
      route_version_id INTEGER, route_template_id INTEGER, is_external INTEGER DEFAULT 0, rework_of_node_id INTEGER, node_code TEXT
    );
    CREATE TABLE process_dependencies (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, predecessor_id INTEGER, successor_id INTEGER, dep_type TEXT DEFAULT 'FS', lag_hours REAL DEFAULT 0, created_at TEXT);
    CREATE TABLE process_standard_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, work_type TEXT, standard_hours REAL, worker_count INTEGER, unit TEXT, description TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE process_executions (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, operator_id INTEGER, action TEXT, result TEXT, hours_worked REAL, quantity_completed INTEGER, defect_quantity INTEGER, timestamp TEXT, notes TEXT, photos TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare("INSERT INTO users (id, username, full_name, role) VALUES (1, 'admin', '管理员', 'admin')").run();
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name, material_grade) VALUES (10, 'M-1', '钢板', 'Q345')").run();
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, part_number, quantity, unit, category) VALUES (100, 1, NULL, 1, 10, 'P-1', 1, '件', '结构件'), (101, 1, NULL, 1, 10, 'P-2', 1, '件', '结构件')").run();
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, part_number, quantity, unit, category) VALUES (200, 2, NULL, 1, 10, 'P-9', 1, '件', '结构件')").run();
  db.prepare("INSERT INTO workstations (id, code, name, station_type, workshop, is_active) VALUES (1, 'WS-ASM', '装配工位', 'assembly', '装配车间', 1)").run();
  db.prepare(`INSERT INTO process_operation_templates
    (id, operation_code, operation_name, operation_type, default_station_type, required_skill, standard_hours, worker_count, qc_required, sequence_hint, is_active)
    VALUES (1, 'OP-ASM', '装配准备', 'assembly', 'assembly', 'assembly', 4, 1, 0, 1, 1)`).run();
  ensureProcessRouteSchema(db);
  return db;
}

async function call(routes, method, path, { params = {}, body = {}, query = {}, user = { uid: 1, role: 'admin', permissions: ['*'] } } = {}) {
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, `missing route ${method} ${path}`);
  const res = mkRes();
  await handler({ params, body, query, user }, res);
  return res;
}

test('UP.1 路线模板创建 + 按部件全层级生成 + 标准工时/依赖/节点编码', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  processRouteService.register(app, db);

  const created = await call(routes, 'POST', '/api/process-route/templates', {
    body: {
      template_code: 'TPL-STRUCT', template_name: '结构件路线', part_category: '结构件',
      steps: [
        { operation_name: '下料', operation_type: 'cutting', standard_hours: 8, worker_count: 1, required_position_code: 'POS-CUT', qc_required: 0 },
        { operation_name: '焊接', operation_type: 'welding', standard_hours: 16, worker_count: 2, required_position_code: 'POS-WELD', qc_required: 1, sop_required: 1 },
      ],
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.steps.length, 2);

  const generated = await call(routes, 'POST', '/api/process-route/instances/:id/generate-from-template', {
    params: { id: 1 }, body: { template_id: created.body.id },
  });
  assert.equal(generated.statusCode, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.created_nodes, 4, '2 个部件 × 2 道工序');
  assert.equal(generated.body.created_hours, 4);
  const nodes = db.prepare('SELECT * FROM process_nodes ORDER BY id').all();
  assert.equal(nodes.length, 4);
  assert.ok(nodes.every((node) => node.node_code === `PN-${node.id}` && node.route_template_id === created.body.id));
  assert.ok(nodes.some((node) => node.operation_name === '焊接' && node.qc_required === 1 && node.sop_required === 1 && node.worker_count === 2));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_dependencies').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_standard_hours').get().c, 4);

  const again = await call(routes, 'POST', '/api/process-route/instances/:id/generate-from-template', {
    params: { id: 1 }, body: { template_id: created.body.id },
  });
  assert.equal(again.body.created_nodes, 0, '重复生成应幂等');
  db.close();
});

test('UP.2 路线健康度 + 依赖感知排程预览/回写', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  processRouteService.register(app, db);
  db.prepare(`INSERT INTO process_nodes (equipment_instance_id, operation_name, operation_type, estimated_hours, status)
    VALUES (1, 'A', 'make', 8, 'ready'), (1, 'B', 'make', 8, 'ready')`).run();
  db.prepare("INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id, dep_type, lag_hours) VALUES (1, 1, 2, 'FS', 0)").run();

  const health = await call(routes, 'GET', '/api/process-route/instances/:id/health', { params: { id: 1 } });
  assert.equal(health.statusCode, 200);
  assert.ok(typeof health.body.score === 'number');
  assert.ok(health.body.issue_count > 0);

  const preview = await call(routes, 'POST', '/api/process-route/instances/:id/schedule/preview', {
    params: { id: 1 }, body: { start_date: '2026-11-09', workday_hours: 8 },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.rows.length, 2);
  assert.ok(preview.body.rows[1].es_hours >= 8, 'FS 依赖应让 B 在 A 之后');

  const applied = await call(routes, 'POST', '/api/process-route/instances/:id/schedule/apply', {
    params: { id: 1 }, body: { start_date: '2026-11-09', workday_hours: 8 },
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.body.updated, 2);
  assert.ok(db.prepare('SELECT planned_start FROM process_nodes WHERE id = 1').get().planned_start);
  db.close();
});

test('UP.3 执行门禁：前置依赖 + ITP 停止点', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO process_nodes (equipment_instance_id, operation_name, operation_type, qc_required) VALUES
    (1, '前序', 'make', 0), (1, '后序', 'make', 1)`).run();
  db.prepare("INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id) VALUES (1, 1, 2)").run();
  const second = db.prepare('SELECT * FROM process_nodes WHERE id = 2').get();

  assert.throws(() => execution.assertStartAllowed(db, second), /前置工序未完成/);
  db.prepare("UPDATE process_nodes SET status = 'completed' WHERE id = 1").run();
  execution.assertStartAllowed(db, second);

  const points = execution.seedItp(db, second);
  assert.equal(points.length, 2);
  assert.throws(() => execution.assertCompleteAllowed(db, second), /ITP 检验点未全部通过/);
  db.prepare("UPDATE process_itp_points SET status = 'passed' WHERE process_node_id = 2").run();
  execution.assertCompleteAllowed(db, second);
  db.close();
});

test('UP.4 版本发布 + ECN 变更影响 + 阶段/成本/KPI/相似项目', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  processRouteService.register(app, db);
  db.prepare(`INSERT INTO process_nodes (equipment_instance_id, operation_name, operation_type, estimated_hours, status, phase_code, worker_count, planned_end)
    VALUES (1, '装配', 'assembly', 8, 'in_progress', 'assembly', 1, '2026-11-01'), (1, '检验', 'qc', 2, 'pending', 'inspection', 1, '2026-11-02')`).run();

  const version = await call(routes, 'POST', '/api/process-route/instances/:id/versions', { params: { id: 1 }, body: { note: '初始版' } });
  assert.equal(version.statusCode, 200, JSON.stringify(version.body));
  assert.equal(version.body.version_no, 'V1');
  const released = await call(routes, 'POST', '/api/process-route/versions/:id/release', { params: { id: version.body.id } });
  assert.equal(released.statusCode, 200);

  db.prepare("UPDATE process_nodes SET estimated_hours = 12 WHERE id = 1").run();
  const change = await call(routes, 'POST', '/api/process-route/instances/:id/changes', { params: { id: 1 }, body: { title: '工时调整', reason: '工艺评审' } });
  assert.equal(change.statusCode, 200, JSON.stringify(change.body));
  assert.ok(change.body.impact.changed.length >= 1);
  const review = await call(routes, 'POST', '/api/process-route/changes/:id/review', { params: { id: change.body.id }, body: { approve: true, note: '同意' } });
  assert.equal(review.body.status, 'approved');

  for (const [path, method, key] of [
    ['/api/process-route/instances/:id/phases', 'GET', 'items'],
    ['/api/process-route/instances/:id/cost', 'GET', 'total'],
    ['/api/process-route/instances/:id/kpi', 'GET', 'completion_pct'],
    ['/api/process-route/instances/:id/similar', 'GET', 'items'],
  ]) {
    const result = await call(routes, method, path, { params: { id: 1 } });
    assert.equal(result.statusCode, 200, `${path} ${JSON.stringify(result.body)}`);
    assert.ok(result.body[key] !== undefined, `${path} missing ${key}`);
  }
  db.close();
});
