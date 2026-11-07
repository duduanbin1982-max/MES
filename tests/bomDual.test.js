'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { registerBomRoutes } = require('../services/bom/service/routes');
const { insertBomNode } = require('../services/bom/service/mutations');
const { ensureBomStructureColumns } = require('../services/bom/service/schema');

function mkRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.sendStatus = (code) => { res.statusCode = code; return res; };
  return res;
}
function captureApp() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler);
  return { app, routes };
}
async function call(routes, method, path, { params = {}, body = {}, query = {}, user = { uid: 1, role: 'admin', permissions: ['*'] } } = {}) {
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, `missing route ${method} ${path}`);
  const res = mkRes();
  await handler({ params, body, query, user }, res, (error) => { if (error) throw error; });
  return res;
}
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, name TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, spec TEXT, unit TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, bom_node_id INTEGER, operation_name TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT, resource_type TEXT, resource_id TEXT, before_json TEXT, after_json TEXT, diff_summary TEXT, ip TEXT, user_agent TEXT, request_id TEXT, status TEXT DEFAULT 'success', error TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, parent_id INTEGER, tier INTEGER, version TEXT, eco_id INTEGER,
      effective_from TEXT, effective_to TEXT, material_id INTEGER, part_number TEXT, quantity REAL, unit TEXT, scrap_factor REAL,
      category TEXT, material_grade TEXT, surface_treatment TEXT, brand_recommend TEXT, brand_grade TEXT, is_alternative INTEGER,
      alternative_group TEXT, alternative_priority INTEGER, operation_id INTEGER, is_phantom INTEGER, is_key_component INTEGER,
      is_wear_part INTEGER, storage_location TEXT, unit_price REAL, weight REAL, notes TEXT, labor_cost REAL, manufacturing_cost REAL,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT, node_type TEXT, level_code TEXT,
      sort_order INTEGER, view_flags TEXT, material_lot_id INTEGER, serial_id INTEGER
    );
  `);
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, name) VALUES (1, 'TBM-1', '一号机', '一号机')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (1, 'M-1', '钢板')").run();
  ensureBomStructureColumns(db);
  return db;
}

test('DUAL.1 EBOM→MBOM 克隆：类型隔离、来源映射', async () => {
  const db = freshDb();
  const { app, routes } = captureApp();
  registerBomRoutes(app, db);
  const root = insertBomNode(db, 1, { tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'ROOT', bom_type: 'EBOM' });
  insertBomNode(db, 1, { parent_id: root.id, tier: 1, quantity: 2, unit: '件', category: '外购成品', part_number: 'SUB', material_id: 1, unit_price: 10, bom_type: 'EBOM' });

  let list = await call(routes, 'GET', '/api/equipment_instances/:id/bom', { params: { id: 1 }, query: { view: 'flat', bom_type: 'EBOM' } });
  assert.equal(list.body.items.length, 2);
  const clone = await call(routes, 'POST', '/api/equipment_instances/:id/bom/clone-to-mbom', { params: { id: 1 } });
  assert.equal(clone.statusCode, 200, JSON.stringify(clone.body));
  assert.equal(clone.body.created, 2);
  assert.throws(() => insertBomNode(db, 1, { tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'OTHER', bom_type: 'EBOM' }), /只能有一个/);

  list = await call(routes, 'GET', '/api/equipment_instances/:id/bom', { params: { id: 1 }, query: { view: 'flat', bom_type: 'MBOM' } });
  assert.equal(list.body.items.length, 2);
  assert.ok(list.body.items.every((row) => row.bom_type === 'MBOM' && row.source_bom_id));
  const mbomRoot = list.body.items.find((row) => row.tier === 0);
  const ebomRoot = db.prepare('SELECT id FROM instance_bom WHERE id = ?').get(root.id);
  assert.equal(mbomRoot.source_bom_id, ebomRoot.id);
  assert.throws(() => insertBomNode(db, 1, { parent_id: mbomRoot.id, tier: 1, quantity: 1, unit: '件', category: '外购成品', part_number: 'X', bom_type: 'EBOM' }), /不属于同一 BOM 类型/);
  db.close();
});

test('DUAL.2 版本/有效性/Redline：MBOM 两版数量差异 + 生效日期过滤', async () => {
  process.env.BOM_RELEASE_MIN_SCORE = '0';
  const db = freshDb();
  const { app, routes } = captureApp();
  registerBomRoutes(app, db);
  const root = insertBomNode(db, 1, { tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'ROOT', bom_type: 'EBOM' });
  insertBomNode(db, 1, { parent_id: root.id, tier: 1, quantity: 1, unit: '件', category: '外购成品', part_number: 'SUB', material_id: 1, unit_price: 10, bom_type: 'EBOM' });
  await call(routes, 'POST', '/api/equipment_instances/:id/bom/clone-to-mbom', { params: { id: 1 } });
  const mbomChild = db.prepare("SELECT id FROM instance_bom WHERE equipment_instance_id = 1 AND COALESCE(bom_type,'EBOM') = 'MBOM' AND tier = 1 LIMIT 1").get();
  insertBomNode(db, 1, { parent_id: mbomChild.id, tier: 2, quantity: 1, unit: '件', category: '外购成品', part_number: 'LEAF-M', material_id: 1, unit_price: 5, bom_type: 'MBOM' });

  const first = await call(routes, 'POST', '/api/equipment_instances/:id/bom/versions/release', {
      params: { id: 1 }, body: { version: 'M1', bom_type: 'MBOM', effective_from: '2026-01-01', baseline_type: 'manufacturing' },
    });
  if (first.statusCode !== 201) console.error('RELEASE FAIL', JSON.stringify(first.body));
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));
  assert.equal(first.body.bom_type, 'MBOM');

  db.prepare("UPDATE instance_bom SET quantity = 3 WHERE equipment_instance_id = 1 AND COALESCE(bom_type,'EBOM') = 'MBOM' AND tier = 1").run();
  const second = await call(routes, 'POST', '/api/equipment_instances/:id/bom/versions/release', {
    params: { id: 1 }, body: { version: 'M2', bom_type: 'MBOM', effective_from: '2026-02-01' },
  });
  assert.equal(second.statusCode, 201, JSON.stringify(second.body));

  const redline = await call(routes, 'GET', '/api/equipment_instances/:id/bom/redline', {
    params: { id: 1 }, query: { from_release_id: first.body.id, to_release_id: second.body.id },
  });
  assert.equal(redline.statusCode, 200);
  assert.ok(redline.body.summary.changed >= 1);
  assert.equal(redline.body.summary.quantity_delta, 2);

  const before = await call(routes, 'GET', '/api/equipment_instances/:id/bom/effectivity', {
    params: { id: 1 }, query: { bom_type: 'MBOM', as_of: '2025-12-31' },
  });
  assert.equal(before.body.active_count, 0);
  const after = await call(routes, 'GET', '/api/equipment_instances/:id/bom/effectivity', {
    params: { id: 1 }, query: { bom_type: 'MBOM', as_of: '2026-03-01' },
  });
  assert.equal(after.body.active_count, 3);
  delete process.env.BOM_RELEASE_MIN_SCORE;
  db.close();
});
