'use strict';

/**
 * tests/auditEcoProcess.test.js
 * 2026-11-07 ECO / 工艺树 / 工序岗位 / 工艺参数 审计修复验证
 *
 * 覆盖：
 *   E-1 ECO 创建校验（必填/重复/实例不存在）与审计
 *   E-2 ECO 状态机（approved 后冻结编辑，open 可编辑）与 404
 *   E-3 ECO 流转权限（缺 equipment:write/process:write 时 403），合法 submit 同步状态
 *   E-4 ECO 影响分析：BOM/图纸/工单风险；无 BOM 命中时不再提前返回
 *   T-1 工艺节点创建：实例/父节点跨实例/负工时/BOM 归属
 *   T-2 工艺节点更新：布尔字段可绑定、自环/跨实例父节点/负值被拒
 *   T-3 工艺节点删除：子节点/工单引用保护；依赖/执行/参数级联清理
 *   T-4 工艺执行：action/hours/operator 校验
 *   P-1 工艺参数：monitor 500 修复、读数边界、specs 校验/去重、偏差检测
 *   M-1 工序/岗位模板：重复编码、负工时、未知岗位、引用保护、审计
 */

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough-for-audit-eco-process-2026';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('node:http');
const { errorHandler, notFoundHandler } = require('../app/errors');

let db;
let server;
let port;

function freshDb() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      full_name TEXT,
      role_code TEXT,
      is_active INTEGER DEFAULT 1,
      token_version INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE equipment_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_code TEXT,
      instance_name TEXT
    );
    CREATE TABLE instance_eco (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      eco_no TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT,
      affected_scope TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      effective_date TEXT,
      closed_date TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      parent_id INTEGER,
      tier INTEGER,
      version TEXT,
      eco_id INTEGER,
      material_id INTEGER,
      part_number TEXT,
      quantity REAL,
      category TEXT,
      is_key_component INTEGER DEFAULT 0,
      unit_price REAL,
      notes TEXT
    );
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER,
      eco_id INTEGER,
      doc_code TEXT,
      doc_no TEXT,
      title TEXT,
      doc_name TEXT,
      version TEXT,
      status TEXT,
      bom_node_id INTEGER,
      revoke_reason TEXT,
      revoked_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_no TEXT,
      status TEXT,
      expected_date TEXT,
      total_amount REAL,
      supplier_id INTEGER,
      equipment_instance_id INTEGER
    );
    CREATE TABLE purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER,
      bom_node_id INTEGER,
      material_id INTEGER,
      quantity REAL,
      received_qty REAL
    );
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_code TEXT,
      title TEXT,
      description TEXT,
      status TEXT,
      planned_end TEXT,
      assigned_to INTEGER,
      estimated_hours REAL,
      actual_hours REAL,
      equipment_instance_id INTEGER,
      process_node_id INTEGER
    );
    CREATE TABLE work_order_qc (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER,
      qc_type TEXT,
      result TEXT,
      inspection_date TEXT,
      defect_description TEXT
    );
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, material_id INTEGER, lot_no TEXT);
    CREATE TABLE inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_lot_id INTEGER,
      quantity REAL,
      location TEXT,
      status TEXT
    );
    CREATE TABLE erp_cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_no TEXT,
      entry_date TEXT,
      description TEXT,
      debit_amount REAL,
      credit_amount REAL,
      source_type TEXT,
      status TEXT,
      equipment_instance_id INTEGER
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      parent_id INTEGER,
      bom_node_id INTEGER,
      operation_name TEXT NOT NULL,
      operation_type TEXT DEFAULT 'make',
      sequence INTEGER DEFAULT 1,
      estimated_hours REAL DEFAULT 0,
      required_workstation_id INTEGER,
      required_skill TEXT,
      required_materials TEXT,
      is_milestone INTEGER DEFAULT 0,
      phase_code TEXT,
      status TEXT DEFAULT 'pending',
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      planned_cost REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      auto_unblock INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      assigned_to INTEGER,
      subsystem_id INTEGER,
      operation_template_id INTEGER,
      required_position_code TEXT,
      worker_count INTEGER DEFAULT 1,
      qc_required INTEGER DEFAULT 0,
      sop_required INTEGER DEFAULT 0,
      drawing_required INTEGER DEFAULT 0
    );
    CREATE TABLE process_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      predecessor_id INTEGER NOT NULL,
      successor_id INTEGER NOT NULL,
      dep_type TEXT DEFAULT 'FS',
      lag_hours REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE process_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      operator_id INTEGER,
      action TEXT NOT NULL,
      result TEXT,
      hours_worked REAL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT,
      photos TEXT,
      quantity_completed INTEGER DEFAULT 0,
      defect_quantity INTEGER DEFAULT 0
    );
    CREATE TABLE process_params (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      recorded_by INTEGER,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      current_amp REAL,
      voltage_v REAL,
      speed_mm_min REAL,
      temperature_c REAL,
      pressure_mpa REAL,
      feed_rate REAL,
      custom_json TEXT,
      notes TEXT
    );
    CREATE TABLE process_standard_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER,
      standard_hours REAL,
      worker_count INTEGER
    );
    CREATE TABLE schedule_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER);
    CREATE TABLE work_report_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER,
      hours_spent REAL,
      status TEXT DEFAULT 'approved'
    );
    CREATE TABLE spc_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER,
      param TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      node_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE workstations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      workshop TEXT,
      station_type TEXT,
      status TEXT DEFAULT 'available',
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, code TEXT, name_zh TEXT);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      role TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      before_json TEXT,
      after_json TEXT,
      diff_summary TEXT,
      ip TEXT,
      user_agent TEXT,
      request_id TEXT,
      status TEXT DEFAULT 'success',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      current_state TEXT NOT NULL,
      assigned_to INTEGER,
      priority INTEGER DEFAULT 0,
      due_date TEXT,
      data TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE workflow_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER,
      from_state TEXT,
      to_state TEXT,
      action TEXT,
      actor_id INTEGER,
      comment TEXT,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.prepare("INSERT INTO users (id, username, full_name, role_code, is_active) VALUES (1, 'admin', '管理员', 'admin', 1), (2, 'worker', '王师傅', 'worker', 1)").run();
  database.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'TBM-1', '一号机'), (2, 'TBM-2', '二号机')").run();
  database.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (1, 'M-1', '刀盘')").run();
  database.prepare("INSERT INTO workstations (id, code, name, workshop, station_type, status, is_active) VALUES (1, 'WS-1', '总装工位', '总装', 'assembly', 'available', 1)").run();
  database.prepare("INSERT INTO equipment_subsystems (id, code, name_zh) VALUES (1, 'cutter', '刀盘')").run();
  return database;
}

function startApp(database) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-perms'];
    const permissions = raw === undefined ? ['*'] : String(raw).split(',').map((item) => item.trim()).filter(Boolean);
    req.user = { sub: 1, uid: 1, role: 'admin', permissions };
    next();
  });
  require('../services/eco').register(app, database);
  require('../services/process').register(app, database);
  require('../services/processMasterService').register(app, database);
  require('../services/plmService').register(app, database);
  require('../routes/instance/process').register(app, database);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(method, path, body, permissions) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (permissions) headers['x-test-perms'] = permissions;
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_error) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createEco(database, overrides) {
  const payload = { eco_no: 'ECO-100', title: '刀盘设计变更', reason: '强度不足', affected_scope: '刀盘', effective_date: '2026-12-01', ...overrides };
  const result = database.prepare(`INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, status)
    VALUES (1, ?, ?, ?, ?, ?, 'open')`).run(payload.eco_no, payload.title, payload.reason, payload.affected_scope, payload.effective_date);
  return Number(result.lastInsertRowid);
}

function createNode(database, overrides) {
  const payload = {
    equipment_instance_id: 1,
    parent_id: null,
    bom_node_id: null,
    operation_name: '下料',
    operation_type: 'make',
    sequence: 1,
    status: 'pending',
    ...overrides,
  };
  const keys = Object.keys(payload);
  const result = database.prepare(`INSERT INTO process_nodes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((key) => payload[key]));
  return Number(result.lastInsertRowid);
}

function countAudit(action) {
  return db.prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?').get(action).c;
}

test.beforeEach(async () => {
  db = freshDb();
  server = startApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
  server = null;
  db = null;
});

test('E-1 ECO 创建：必填/重复/实例不存在被拒，并写审计', async () => {
  const created = await request('POST', '/api/equipment_instances/1/eco', { eco_no: 'ECO-1', title: '变更一' });
  assert.equal(created.status, 200);
  assert.ok(created.body.id > 0);

  const duplicate = await request('POST', '/api/equipment_instances/1/eco', { eco_no: 'ECO-1', title: '重复' });
  assert.equal(duplicate.status, 409);

  const missingTitle = await request('POST', '/api/equipment_instances/1/eco', { eco_no: 'ECO-2' });
  assert.equal(missingTitle.status, 400);

  const badDate = await request('POST', '/api/equipment_instances/1/eco', { eco_no: 'ECO-3', title: '坏日期', effective_date: '2026-13-40' });
  assert.equal(badDate.status, 400);

  const missingInstance = await request('POST', '/api/equipment_instances/999/eco', { eco_no: 'ECO-4', title: '无实例' });
  assert.equal(missingInstance.status, 404);

  assert.equal(countAudit('eco.create'), 1);
  assert.equal(db.prepare("SELECT user_id FROM audit_logs WHERE action='eco.create'").get().user_id, 1);
});

test('E-2 ECO 编辑状态机：open 可改，approved 冻结，缺失 404', async () => {
  const ecoId = createEco(db);
  const updated = await request('PUT', '/api/instance_eco/' + ecoId, { title: '批准前改名', effective_date: '2026-12-31' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.changes, 1);
  assert.equal(db.prepare('SELECT title FROM instance_eco WHERE id=?').get(ecoId).title, '批准前改名');
  assert.equal(countAudit('eco.update'), 1);

  db.prepare("UPDATE instance_eco SET status='approved' WHERE id=?").run(ecoId);
  const frozen = await request('PUT', '/api/instance_eco/' + ecoId, { title: '批准后改名' });
  assert.equal(frozen.status, 409);

  const notFound = await request('PUT', '/api/instance_eco/99999', { title: 'x' });
  assert.equal(notFound.status, 404);
});

test('E-3 ECO 流转：缺权限 403；submit 同步状态并写审计；非法 action 400', async () => {
  const ecoId = createEco(db);
  const forbidden = await request('POST', '/api/instance_eco/' + ecoId + '/transit', { action: 'submit' }, 'work_order:read');
  assert.equal(forbidden.status, 403);

  const submitted = await request('POST', '/api/instance_eco/' + ecoId + '/transit', { action: 'submit', comment: '提交评审' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.instance.current_state, 'review');
  assert.equal(db.prepare('SELECT status FROM instance_eco WHERE id=?').get(ecoId).status, 'review');
  assert.ok(countAudit('eco.transit') >= 1);

  const invalid = await request('POST', '/api/instance_eco/' + ecoId + '/transit', { action: 'ship' });
  assert.equal(invalid.status, 400);
});

test('E-4 ECO 影响分析：BOM/图纸/工单风险；无 BOM 命中不再提前返回', async () => {
  const ecoId = createEco(db, { eco_no: 'ECO-IMP', affected_scope: '刀盘' });
  const bomId = Number(db.prepare("INSERT INTO instance_bom (equipment_instance_id, parent_id, tier, part_number, quantity, category, is_key_component, unit_price, notes) VALUES (1, NULL, 1, 'DP-001', 1, '刀盘', 1, 1000, '刀盘主体')").run().lastInsertRowid);
  db.prepare("INSERT INTO documents (equipment_instance_id, eco_id, doc_code, title, version, status, bom_node_id) VALUES (1, ?, 'DOC-1', '刀盘图', 'A0', 'issued', ?)").run(ecoId, bomId);
  db.prepare("INSERT INTO work_orders (wo_code, title, status, planned_end, equipment_instance_id) VALUES ('WO-1', '刀盘装配', 'in_progress', '2026-12-10', 1)").run();
  db.prepare("INSERT INTO purchase_orders (po_no, status, expected_date, total_amount, equipment_instance_id) VALUES ('PO-1', 'submitted', '2026-12-05', 5000, 1)").run();

  const impact = await request('GET', '/api/instance_eco/' + ecoId + '/impact');
  assert.equal(impact.status, 200);
  assert.equal(impact.body.summary.bom, 1);
  assert.equal(impact.body.summary.documents, 1);
  assert.equal(impact.body.summary.work_orders, 1);
  assert.ok(impact.body.summary.impact_score >= 4);
  assert.ok(impact.body.risks.some((item) => item.type === 'key_component'));
  assert.ok(impact.body.risks.some((item) => item.type === 'document'));

  const missId = createEco(db, { eco_no: 'ECO-MISS', affected_scope: '不存在的范围' });
  const miss = await request('GET', '/api/instance_eco/' + missId + '/impact');
  assert.equal(miss.status, 200);
  assert.equal(miss.body.summary.bom, 0);
  assert.ok(Array.isArray(miss.body.risks));
  assert.ok(miss.body.risks.some((item) => item.type === 'bom'));
  assert.equal(typeof miss.body.summary.impact_score, 'number');
});

test('E-5 PLM ECO 状态机：draft 才能批准、approved 才能实施，重复流转 409 + 审计', async () => {
  const badRevision = await request('POST', '/api/plm/ecos', { title: '坏版本', new_revision: 'B' });
  assert.equal(badRevision.status, 400);
  const badType = await request('POST', '/api/plm/ecos', { title: '坏类型', change_type: 'hack' });
  assert.equal(badType.status, 400);

  const created = await request('POST', '/api/plm/ecos', { title: '图纸变更', change_type: 'design', new_revision: 'B0' });
  assert.equal(created.status, 200);
  const id = created.body.id;

  const earlyImplement = await request('PUT', '/api/plm/ecos/' + id + '/implement', {});
  assert.equal(earlyImplement.status, 409);

  const approve = await request('PUT', '/api/plm/ecos/' + id + '/approve', { approved_by: 'admin' });
  assert.equal(approve.status, 200);
  const approveAgain = await request('PUT', '/api/plm/ecos/' + id + '/approve', { approved_by: 'admin' });
  assert.equal(approveAgain.status, 409);

  const implement = await request('PUT', '/api/plm/ecos/' + id + '/implement', {});
  assert.equal(implement.status, 200);
  const implementAgain = await request('PUT', '/api/plm/ecos/' + id + '/implement', {});
  assert.equal(implementAgain.status, 409);

  assert.equal(countAudit('plm_eco.create'), 1);
  assert.equal(countAudit('plm_eco.approve'), 1);
  assert.equal(countAudit('plm_eco.implement'), 1);
});

test('T-1 工艺节点创建：实例/父节点跨实例/负工时/BOM 归属校验 + 审计', async () => {
  const noInstance = await request('POST', '/api/process_nodes', { equipment_instance_id: 999, operation_name: '下料' });
  assert.equal(noInstance.status, 404);

  const node2 = createNode(db, { equipment_instance_id: 2, operation_name: '二号机工序' });
  const crossParent = await request('POST', '/api/process_nodes', { equipment_instance_id: 1, parent_id: node2, operation_name: '跨实例子节点' });
  assert.equal(crossParent.status, 400);

  const negative = await request('POST', '/api/process_nodes', { equipment_instance_id: 1, operation_name: '负工时', estimated_hours: -1 });
  assert.equal(negative.status, 400);

  const bom2 = Number(db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, part_number, quantity) VALUES (2, 1, 'P-2', 1)").run().lastInsertRowid);
  const wrongBom = await request('POST', '/api/process_nodes', { equipment_instance_id: 1, bom_node_id: bom2, operation_name: '错 BOM' });
  assert.equal(wrongBom.status, 400);

  const created = await request('POST', '/api/process_nodes', { equipment_instance_id: 1, operation_name: '正常下料', estimated_hours: 3, worker_count: 2 });
  assert.equal(created.status, 200);
  assert.ok(created.body.id > 0);
  assert.equal(countAudit('process_node.create'), 1);
});

test('T-2 工艺节点更新：布尔字段可绑定、自环/跨实例父节点/负值被拒', async () => {
  const nodeA = createNode(db, { operation_name: 'A' });
  const nodeB = createNode(db, { operation_name: 'B', parent_id: nodeA });
  const nodeOther = createNode(db, { equipment_instance_id: 2, operation_name: '别的实例' });

  const boolUpdate = await request('PUT', '/api/process_nodes/' + nodeA, { qc_required: true, sop_required: false, is_milestone: true });
  assert.equal(boolUpdate.status, 200);
  const row = db.prepare('SELECT qc_required, sop_required, is_milestone FROM process_nodes WHERE id=?').get(nodeA);
  assert.deepEqual({ ...row }, { qc_required: 1, sop_required: 0, is_milestone: 1 });

  const selfParent = await request('PUT', '/api/process_nodes/' + nodeA, { parent_id: nodeA });
  assert.equal(selfParent.status, 400);

  const cycle = await request('PUT', '/api/process_nodes/' + nodeA, { parent_id: nodeB });
  assert.equal(cycle.status, 400);

  const crossInstance = await request('PUT', '/api/process_nodes/' + nodeA, { parent_id: nodeOther });
  assert.equal(crossInstance.status, 400);

  const negative = await request('PUT', '/api/process_nodes/' + nodeA, { estimated_hours: -5 });
  assert.equal(negative.status, 400);

  assert.ok(countAudit('process_node.update') >= 1);
});

test('T-3 工艺节点删除：子节点/工单引用保护；依赖/执行/参数级联清理', async () => {
  const parent = createNode(db, { operation_name: '父节点' });
  createNode(db, { operation_name: '子节点', parent_id: parent });
  const blockedChildren = await request('DELETE', '/api/process_nodes/' + parent);
  assert.equal(blockedChildren.status, 409);

  const referenced = createNode(db, { operation_name: '被工单引用' });
  db.prepare("INSERT INTO work_orders (wo_code, title, status, process_node_id, equipment_instance_id) VALUES ('WO-9', '引用节点', 'pending', ?, 1)").run(referenced);
  const blockedWo = await request('DELETE', '/api/process_nodes/' + referenced);
  assert.equal(blockedWo.status, 409);

  const leaf = createNode(db, { operation_name: '可删叶子' });
  const other = createNode(db, { operation_name: '另一个节点' });
  db.prepare("INSERT INTO process_dependencies (equipment_instance_id, predecessor_id, successor_id) VALUES (1, ?, ?)").run(leaf, other);
  db.prepare("INSERT INTO process_executions (process_node_id, action, hours_worked) VALUES (?, 'start', 1)").run(leaf);
  db.prepare("INSERT INTO process_params (process_node_id, current_amp) VALUES (?, 10)").run(leaf);
  const deleted = await request('DELETE', '/api/process_nodes/' + leaf);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.cascaded.dependencies, 1);
  assert.equal(deleted.body.cascaded.executions, 1);
  assert.equal(deleted.body.cascaded.params, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_nodes WHERE id=?').get(leaf).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM process_dependencies WHERE predecessor_id=?').get(leaf).c, 0);
  assert.ok(countAudit('process_node.delete') >= 1);
});

test('T-4 工艺执行：action/hours/operator 校验，合法 start 写执行记录', async () => {
  const node = createNode(db, { operation_name: '执行节点', status: 'ready' });
  const badAction = await request('POST', '/api/process_nodes/' + node + '/execute', { action: 'explode' });
  assert.equal(badAction.status, 400);

  const badHours = await request('POST', '/api/process_nodes/' + node + '/execute', { action: 'start', hours_worked: -1 });
  assert.equal(badHours.status, 400);

  const badOperator = await request('POST', '/api/process_nodes/' + node + '/execute', { action: 'start', operator_id: 999 });
  assert.equal(badOperator.status, 400);

  const ok = await request('POST', '/api/process_nodes/' + node + '/execute', { action: 'start', operator_id: 2, hours_worked: 2.5 });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM process_executions WHERE process_node_id=? AND action='start'").get(node).c, 1);
  assert.equal(db.prepare('SELECT status FROM process_nodes WHERE id=?').get(node).status, 'in_progress');
  assert.ok(countAudit('process_node.execute') >= 1);
});

test('T-5 工艺树路由权限：process:write 可生成树/改子系统，缺权限 403', async () => {
  const node = createNode(db, { operation_name: '权限节点' });
  const patchOk = await request('PATCH', '/api/process_nodes/' + node + '/subsystem', { subsystem_id: 1 }, 'process:write');
  assert.equal(patchOk.status, 200);
  assert.equal(patchOk.body.node.subsystem_id, 1);

  const patchDenied = await request('PATCH', '/api/process_nodes/' + node + '/subsystem', { subsystem_id: null }, 'equipment:read');
  assert.equal(patchDenied.status, 403);

  const generateOk = await request('POST', '/api/equipment_instances/1/process_tree/generate', {}, 'process:write');
  assert.equal(generateOk.status, 200);
  assert.ok(generateOk.body.node_count >= 1);

  const generateDenied = await request('POST', '/api/equipment_instances/1/process_tree/generate', {}, 'shopfloor:read');
  assert.equal(generateDenied.status, 403);
});

test('P-1 工艺参数：monitor 修复、读数边界、specs 校验/去重、偏差检测', async () => {
  const node = createNode(db, { operation_name: '参数节点', status: 'pending' });

  const negative = await request('POST', '/api/process_nodes/' + node + '/params', { current_amp: -1 });
  assert.equal(negative.status, 400);
  const notNumber = await request('POST', '/api/process_nodes/' + node + '/params', { current_amp: 'abc' });
  assert.equal(notNumber.status, 400);

  const reading = await request('POST', '/api/process_nodes/' + node + '/params', { current_amp: 100, temperature_c: 88, notes: '首件' });
  assert.equal(reading.status, 200);

  const monitor = await request('GET', '/api/process/monitor?equipment_instance_id=1');
  assert.equal(monitor.status, 200);
  assert.equal(monitor.body.nodes.length, 1);
  assert.equal(monitor.body.nodes[0].node_type, 'make');
  assert.equal(monitor.body.nodes[0].last_params.temperature_c, 88);

  const badSpec = await request('PUT', '/api/process_nodes/' + node + '/params/specs', { specs: { current_amp: { lsl: 10, usl: 1 } } });
  assert.equal(badSpec.status, 400);
  const unknownKey = await request('PUT', '/api/process_nodes/' + node + '/params/specs', { specs: { unknown_param: { lsl: 0, usl: 1 } } });
  assert.equal(unknownKey.status, 400);

  const firstSpec = await request('PUT', '/api/process_nodes/' + node + '/params/specs', { specs: { current_amp: { lsl: 0, usl: 120 }, temperature_c: { lsl: 0, usl: 80, unit: '°C' } } });
  assert.equal(firstSpec.status, 200);
  const updatedSpec = await request('PUT', '/api/process_nodes/' + node + '/params/specs', { specs: { temperature_c: { lsl: 0, usl: 80, unit: '°C' } } });
  assert.equal(updatedSpec.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM process_params WHERE process_node_id=? AND custom_json IS NOT NULL").get(node).c, 1, '重复保存 specs 应更新同一行');

  const deviations = await request('GET', '/api/process/deviations?limit=10');
  assert.equal(deviations.status, 200);
  assert.equal(deviations.body.total, 1);
  assert.equal(deviations.body.items[0].param, 'temperature_c');
  assert.equal(deviations.body.items[0].deviation, 'high');

  const list = await request('GET', '/api/process_nodes/' + node + '/params');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1, 'spec 行不应作为参数读数返回');
  assert.equal(countAudit('process_params.create'), 1);
});

test('M-1 工序/岗位：重复编码、边界、未知岗位、引用保护与审计', async () => {
  const position = await request('POST', '/api/process-master/positions', { position_code: 'painter2', position_name: '涂装工2', min_level: 2 });
  assert.equal(position.status, 201);
  const duplicatePosition = await request('POST', '/api/process-master/positions', { position_code: 'painter2', position_name: '重复' });
  assert.equal(duplicatePosition.status, 409);
  const badLevel = await request('POST', '/api/process-master/positions', { position_code: 'painter3', position_name: '涂装工3', min_level: 0 });
  assert.equal(badLevel.status, 400);

  const unknownPosition = await request('POST', '/api/process-master/operations', { operation_code: 'painting2', operation_name: '喷漆2', required_position_code: 'ghost' });
  assert.equal(unknownPosition.status, 400);
  const negativeHours = await request('POST', '/api/process-master/operations', { operation_code: 'painting3', operation_name: '喷漆3', standard_hours: -1 });
  assert.equal(negativeHours.status, 400);
  const duplicateOperation = await request('POST', '/api/process-master/operations', { operation_code: 'cutting', operation_name: '重复下料' });
  assert.equal(duplicateOperation.status, 409);

  const operation = await request('POST', '/api/process-master/operations', { operation_code: 'painting2', operation_name: '喷漆2', required_position_code: 'painter2', standard_hours: 3 });
  assert.equal(operation.status, 201);

  const badUpdate = await request('PUT', '/api/process-master/operations/' + operation.body.id, { standard_hours: -2 });
  assert.equal(badUpdate.status, 400);
  const ghostUpdate = await request('PUT', '/api/process-master/operations/' + operation.body.id, { required_position_code: 'ghost' });
  assert.equal(ghostUpdate.status, 400);

  const blockedDelete = await request('DELETE', '/api/process-master/positions/painter2');
  assert.equal(blockedDelete.status, 409);

  assert.ok(countAudit('process_master.position.create') >= 1);
  assert.ok(countAudit('process_master.operation.create') >= 1);
});
