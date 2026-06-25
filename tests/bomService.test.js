'use strict';

/**
 * bomService.test.js
 * P2 BOM 管理测试
 * 10 用例: validateNode / validateTree / calcCost / compareVersions / parseCsv / CRUD
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');

// stub auth
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { exports: { requirePermission: () => (req, res, next) => next() } };

const bomService = require('../services/bomService');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      parent_id INTEGER,
      tier INTEGER NOT NULL DEFAULT 2,
      version TEXT DEFAULT 'A0',
      eco_id INTEGER,
      effective_from TEXT, effective_to TEXT,
      material_id INTEGER, part_number TEXT,
      quantity REAL NOT NULL DEFAULT 1, unit TEXT DEFAULT '件',
      scrap_factor REAL DEFAULT 1.0, category TEXT,
      material_grade TEXT, surface_treatment TEXT,
      brand_recommend TEXT, brand_grade TEXT,
      is_alternative INTEGER DEFAULT 0, alternative_group TEXT, alternative_priority INTEGER DEFAULT 1,
      operation_id INTEGER, is_phantom INTEGER DEFAULT 0,
      is_key_component INTEGER DEFAULT 0, is_wear_part INTEGER DEFAULT 0, storage_location TEXT,
      weight REAL, unit_price REAL, notes TEXT,
      created_by INTEGER, created_at TEXT DEFAULT '2026-01-01 00:00:00', updated_at TEXT
    );
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, unit TEXT, spec TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, name TEXT);
  `);
  // 必要种子
  db.prepare("INSERT INTO equipment_instances (id, name) VALUES (1, '测试设备')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name, unit) VALUES (10, 'M-A', 'A零件', '件'), (11, 'M-B', 'B零件', '件'), (12, 'M-C', 'C零件', '件')").run();
  return db;
}

function mkApp(db) {
  const app = { get: () => {}, post: () => {}, put: () => {}, delete: () => {} };
  const routes = {};
  ['get', 'post', 'put', 'delete'].forEach(m => {
    app[m] = (p, h) => { routes[m.toUpperCase() + ' ' + p] = h; };
  });
  bomService.register(app, db);
  // 找路由 handler
  const find = (method, path) => routes[method + ' ' + path];
  return { app, routes, find };
}

test('P2.BOM.1 validateNode 基础校验', () => {
  const v1 = bomService.validateNode({ tier: 2, quantity: 1, unit: '件', category: '外购成品' })
  assert.equal(v1.ok, true)
  const v2 = bomService.validateNode({ tier: 5, quantity: 1, unit: '件' })
  assert.equal(v2.ok, false)
  assert.ok(v2.errors.some(e => e.includes('tier')))
  const v3 = bomService.validateNode({ tier: 2, quantity: 0, unit: '件' })
  assert.ok(v3.errors.some(e => e.includes('quantity')))
  const v4 = bomService.validateNode({ tier: 2, quantity: 1, unit: '袋' })
  assert.ok(v4.errors.some(e => e.includes('unit')))
  // 自身 parent 循环
  const v5 = bomService.validateNode({ id: 1, parent_id: 1, tier: 2, quantity: 1, unit: '件' })
  assert.ok(v5.errors.some(e => e.includes('parent_id')))
})

test('P2.BOM.2 validateTree 根/循环/物料/虚项', () => {
  const db = freshDb()
  // 缺根
  let r = bomService.validateTree(db, 1)
  assert.ok(r.errors.some(e => e.includes('根节点')))
  // 加根 + 子
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, quantity, unit, category) VALUES (1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, parent_id, material_id, quantity, unit, category) VALUES (1, 2, 1, 10, 2, '件', '外购成品')").run()
  r = bomService.validateTree(db, 1)
  assert.equal(r.ok, true)
  // 循环
  db.prepare("UPDATE instance_bom SET parent_id = 2 WHERE id = 1").run()  // 根指向子 → 循环
  r = bomService.validateTree(db, 1)
  assert.ok(r.errors.some(e => e.includes('循环')))
  // 修
  db.prepare("UPDATE instance_bom SET parent_id = NULL WHERE id = 1").run()
  // 物料不存在
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, parent_id, material_id, quantity, unit, category) VALUES (1, 2, 1, 999, 1, '件', '外购成品')").run()
  r = bomService.validateTree(db, 1)
  assert.ok(r.errors.some(e => e.includes('物料不存在')))
  // 虚项作叶子
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, parent_id, is_phantom, quantity, unit, category) VALUES (1, 1, 1, 1, 1, '套', '自制部件')").run()
  r = bomService.validateTree(db, 1)
  assert.ok(r.errors.some(e => e.includes('虚项')))
})

test('P2.BOM.3 calcCost 叶子累加', () => {
  const db = freshDb()
  // 根 tier=0, 部件 tier=1, 零件 tier=2
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category, unit_price) VALUES (1, 1, 0, 1, '台', '成品', 0)").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, quantity, unit, category, unit_price) VALUES (2, 1, 1, 1, 1, '套', '自制部件', 0)").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category, unit_price) VALUES (3, 1, 2, 2, 10, 2, '件', '外购成品', 50)").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category, unit_price) VALUES (4, 1, 2, 2, 11, 1, '件', '外购成品', 200)").run()
  const costs = bomService.calcCost(db, 1)
  // 3: 2*50=100, 4: 1*200=200, 2 (部件) = 100+200=300, 1 (根) = 300+0=300
  const c3 = costs.find(c => c.id === 3)
  const c2 = costs.find(c => c.id === 2)
  assert.equal(c3.cost, 100)
  assert.equal(c2.cost, 300)
})

test('P2.BOM.4 calcCost 虚项不计成本', () => {
  const db = freshDb()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category, unit_price) VALUES (1, 1, 0, 1, '台', '成品', 0)").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, is_phantom, quantity, unit, category) VALUES (2, 1, 1, 1, 1, 1, '套', '自制部件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category, unit_price) VALUES (3, 1, 2, 2, 10, 3, '件', '外购成品', 10)").run()
  const costs = bomService.calcCost(db, 1)
  const c1 = costs.find(c => c.id === 1)
  // 虚项 c2 不计自身, 但子件 c3: 3*10=30, c2 = 30, c1 = 30
  assert.equal(c1.cost, 30)
})

test('P2.BOM.5 calcCost scrap_factor', () => {
  const db = freshDb()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category, unit_price) VALUES (1, 1, 0, 1, '台', '成品', 0)").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category, unit_price, scrap_factor) VALUES (2, 1, 1, 2, 10, 1, '件', '外购成品', 100, 1.1)").run()
  const costs = bomService.calcCost(db, 1)
  // 1 * 100 * 1.1 = 110
  const c1 = costs.find(c => c.id === 1)
  assert.equal(c1.cost, 110)
})

test('P2.BOM.6 compareVersions ECO 对比', () => {
  const db = freshDb()
  // A0: 1 个
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, material_id, quantity, unit, version, category) VALUES (1, 2, 10, 1, '件', 'A0', '外购成品')").run()
  // A1: 加了 1 个, 改了 1 个
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, material_id, quantity, unit, version, category) VALUES (1, 2, 10, 2, '件', 'A1', '外购成品')").run()  // 改数量
  db.prepare("INSERT INTO instance_bom (equipment_instance_id, tier, material_id, quantity, unit, version, category) VALUES (1, 2, 11, 3, '件', 'A1', '外购成品')").run()  // 新增
  const r = bomService.compareVersions(db, 1, 'A0', 'A1')
  assert.equal(r.added.length, 1)
  assert.equal(r.removed.length, 0)
  assert.ok(r.changed.length >= 1)
  assert.equal(r.count.A, 1)
  assert.equal(r.count.B, 2)
})

test('P2.BOM.7 parseCsv 解析', () => {
  const csv = `tier,material_id,quantity,unit,category
2,10,5,件,外购成品
2,11,2,个,标准紧固件`
  const r = bomService.parseCsv(csv)
  assert.equal(r.headers.length, 5)
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].quantity, '5')
})

test('P2.BOM.8 POST/DELETE 节点 + 级联删除', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  // POST 根
  const rootHandler = find('POST', '/api/equipment_instances/:id/bom')
  const reqRoot = { params: { id: 1 }, body: { tier: 0, quantity: 1, unit: '台', category: '成品' }, user: { uid: 1 } }
  const resRoot = mkRes()
  rootHandler(reqRoot, resRoot, () => {})
  assert.equal(resRoot._j.status, 200)
  const rootId = resRoot._j.json.id
  // POST 子
  const reqChild = { params: { id: 1 }, body: { tier: 2, parent_id: rootId, material_id: 10, quantity: 2, unit: '件', category: '外购成品' }, user: { uid: 1 } }
  const resChild = mkRes()
  rootHandler(reqChild, resChild, () => {})
  assert.equal(resChild._j.status, 200)
  const childId = resChild._j.json.id
  // DELETE 根 → 应级联删子
  const delHandler = find('DELETE', '/api/bom/:id')
  const resDel = mkRes()
  delHandler({ params: { id: rootId } }, resDel, () => {})
  assert.equal(resDel._j.json.count, 2)
  assert.equal(db.prepare('SELECT count(*) AS c FROM instance_bom').get().c, 0)
})

test('P2.BOM.9 POST 校验失败返 400', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('POST', '/api/equipment_instances/:id/bom')
  const next = (err) => { next.err = err }
  const req = { params: { id: 1 }, body: { tier: 5, quantity: 0, unit: '袋' }, user: { uid: 1 } }
  const res = mkRes()
  handler(req, res, next)
  assert.ok(next.err)
  assert.equal(next.err.status, 400)
})

test('P2.BOM.10 POST 导入 CSV 成功', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  const handler = find('POST', '/api/equipment_instances/:id/bom/import')
  const csv = `tier,material_id,quantity,unit,category
0,,1,台,成品
2,10,5,件,外购成品
2,11,2,个,标准紧固件`
  const req = { params: { id: 1 }, body: { csv }, user: { uid: 1 } }
  const res = mkRes()
  handler(req, res, () => {})
  assert.equal(res._j.json.inserted, 3)
  assert.equal(res._j.json.errors, 0)
  assert.equal(db.prepare('SELECT count(*) AS c FROM instance_bom').get().c, 3)
})

function mkRes() {
  const j = { status: 200, json: null }
  const res = {
    _j: j,
    status: (s) => { j.status = s; return res },
    json: (x) => { j.json = x; return res },
  }
  return res
}

// ============== P2 BOM 4 级拆分法测试 ==============

test('P2.BOM.11 GET /bom 默认返树状 + tier_summary', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category) VALUES (1, 1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (2, 1, 1, 1, 10, 1, '套', '自制部件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (3, 1, 2, 2, 11, 5, '件', '标准紧固件')").run()
  const handler = find('GET', '/api/equipment_instances/:id/bom')
  const req = { params: { id: 1 }, query: {} }
  const res = mkRes()
  handler(req, res, () => {})
  const j = res._j.json
  assert.equal(j.view, 'tree')
  assert.deepEqual(j.tier_summary, { 0: 1, 1: 1, 2: 1, 3: 0, total: 3 })
  assert.equal(j.tree.length, 1, '应只有 1 个根 (tier 0)')
  assert.equal(j.tree[0].id, 1)
  assert.equal(j.tree[0].children.length, 1, '根下挂 1 个部件')
  assert.equal(j.tree[0].children[0].id, 2)
  assert.equal(j.tree[0].children[0].children.length, 1, '部件下挂 1 个零件')
  assert.equal(j.tree[0].children[0].children[0].id, 3)
})

test('P2.BOM.12 GET /bom?view=flat 返平铺', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category) VALUES (1, 1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (2, 1, 1, 1, 10, 1, '套', '自制部件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (3, 1, 2, 2, 11, 5, '件', '标准紧固件')").run()
  const handler = find('GET', '/api/equipment_instances/:id/bom')
  const res = mkRes()
  handler({ params: { id: 1 }, query: { view: 'flat' } }, res, () => {})
  const j = res._j.json
  assert.equal(j.view, 'flat')
  assert.equal(j.total, 3)
  assert.equal(j.items.length, 3)
})

test('P2.BOM.13 GET /bom?view=flat&tier=2 只返零件清单 (给采购)', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category) VALUES (1, 1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (2, 1, 1, 1, 10, 1, '套', '自制部件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (3, 1, 2, 2, 11, 5, '件', '标准紧固件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (4, 1, 2, 2, 12, 3, '件', '外购成品')").run()
  const handler = find('GET', '/api/equipment_instances/:id/bom')
  const res = mkRes()
  handler({ params: { id: 1 }, query: { view: 'flat', tier: 2 } }, res, () => {})
  const j = res._j.json
  assert.equal(j.total, 2, 'tier=2 应该有 2 个零件')
  assert.ok(j.items.every(it => it.tier === 2))
  assert.equal(j.tier, 2)
})

test('P2.BOM.14 GET /bom?part_id=N 只看某部件下的子件', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category) VALUES (1, 1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (2, 1, 1, 1, 10, 1, '套', '自制部件-A')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (3, 1, 2, 2, 11, 5, '件', '标准紧固件')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (4, 1, 1, 1, 12, 1, '套', '自制部件-B')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (5, 1, 4, 2, 13, 2, '件', '外购成品')").run()
  const handler = find('GET', '/api/equipment_instances/:id/bom')
  const res = mkRes()
  // 只看部件-A (id=2) 下的子件
  handler({ params: { id: 1 }, query: { part_id: 2, view: 'flat' } }, res, () => {})
  const j = res._j.json
  assert.equal(j.total, 2, '部件-A 自己和它下面的 1 个零件')
  const ids = j.items.map(it => it.id).sort()
  assert.deepEqual(ids, [2, 3])
})

test('P2.BOM.15 GET /bom/levels 4 级一次性出齐', () => {
  const db = freshDb()
  const { find } = mkApp(db)
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, tier, quantity, unit, category) VALUES (1, 1, 0, 1, '台', '成品')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (2, 1, 1, 1, 10, 1, '套', '部件A')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (3, 1, 1, 1, 11, 1, '套', '部件B')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (4, 1, 2, 2, 12, 3, '件', '零件X')").run()
  db.prepare("INSERT INTO instance_bom (id, equipment_instance_id, parent_id, tier, material_id, quantity, unit, category) VALUES (5, 1, 4, 3, 13, 1, '米', '毛坯')").run()
  const handler = find('GET', '/api/equipment_instances/:id/bom/levels')
  const res = mkRes()
  handler({ params: { id: 1 }, query: {} }, res, () => {})
  const j = res._j.json
  assert.equal(j.levels[0].length, 1, '总装 1 个')
  assert.equal(j.levels[1].length, 2, '部件 2 个 (A, B)')
  assert.equal(j.levels[2].length, 1, '零件 1 个 (X)')
  assert.equal(j.levels[3].length, 1, '毛坯 1 个')
  assert.equal(j.summary.total, 5)
})