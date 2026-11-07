'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { computeHealth } = require('../services/bom/core');
const repair = require('../services/bom/service/repair');
const versions = require('../services/bom/service/versions');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, name TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, spec TEXT, unit TEXT, is_self_made INTEGER DEFAULT 0, estimated_unit_price REAL DEFAULT 0, actual_unit_price REAL DEFAULT 0);
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
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, name) VALUES (1, 'TBM-1', '一号机', '一号机'), (2, 'TBM-2', '二号机', '二号机'), (3, 'TBM-3', '三号机', '三号机')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (1, 'M-1', '钢板')").run();
  return db;
}

function insert(db, row) {
  const columns = Object.keys(row);
  return Number(db.prepare(`INSERT INTO instance_bom (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((key) => row[key])).lastInsertRowid);
}

test('BH.1 健康分：无根 BOM 被识别为 missing，并给出可修复问题', () => {
  const db = freshDb();
  insert(db, { equipment_instance_id: 1, parent_id: null, tier: 1, quantity: 1, unit: '套', category: '自制部件', part_number: 'SUB-1', material_grade: 'Q345', surface_treatment: '无' });
  insert(db, { equipment_instance_id: 1, parent_id: 1, tier: 2, quantity: 1, unit: '件', category: '外购成品', part_number: 'LEAF-1', material_id: 1 });
  const health = computeHealth(db, 1);
  assert.equal(health.root_state, 'missing');
  assert.equal(health.root_count, 0);
  assert.equal(health.release_gate.can_release, false);
  assert.ok(health.issues.some((issue) => issue.severity === 'error'));
  assert.ok(health.score < 100);
  db.close();
});

test('BH.2 缺根修复：创建根并挂接 1 级部件，重复执行幂等', () => {
  const db = freshDb();
  insert(db, { equipment_instance_id: 1, parent_id: null, tier: 1, quantity: 1, unit: '套', category: '自制部件', part_number: 'SUB-1', material_grade: 'Q345', surface_treatment: '无' });
  insert(db, { equipment_instance_id: 1, parent_id: null, tier: 2, quantity: 1, unit: '件', category: '外购成品', part_number: 'LEAF-1', material_id: 1 });
  const preview = repair.diagnose(db, 1);
  assert.ok(preview.actions.some((action) => action.code === 'create_root'));
  assert.ok(preview.actions.some((action) => action.code === 'attach_parentless'));
  const applied = repair.applyRepair(db, 1, {});
  assert.ok(applied.after.root_count === 1);
  assert.equal(applied.after.health.root_state, 'single');
  assert.equal(applied.log.attached, 1, '仅 1 级部件可自动挂接');
  assert.equal(applied.after.manual_count, 1, '2 级无父节点需人工处理');
  const second = repair.diagnose(db, 1);
  assert.ok(!second.actions.some((action) => action.code === 'attach_parentless'));
  db.close();
});

test('BH.3 多根修复：指定主根，其余根降为 1 级并下移子树层级', () => {
  const db = freshDb();
  const rootA = insert(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'ROOT-A' });
  const rootB = insert(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'ROOT-B' });
  insert(db, { equipment_instance_id: 1, parent_id: rootB, tier: 1, quantity: 1, unit: '套', category: '自制部件', part_number: 'SUB-B' });
  const result = repair.applyRepair(db, 1, { actions: ['merge_roots'], root_bom_id: rootA });
  assert.equal(result.after.root_count, 1);
  assert.equal(result.log.merged, 1);
  assert.equal(Number(db.prepare('SELECT tier FROM instance_bom WHERE id = ?').get(rootB).tier), 1);
  assert.equal(Number(db.prepare('SELECT parent_id FROM instance_bom WHERE id = ?').get(rootB).parent_id), rootA);
  db.close();
});

test('BH.4 空 BOM：可创建根节点，但明确仍需补 1/2 级', () => {
  const db = freshDb();
  const preview = repair.diagnose(db, 2);
  assert.equal(preview.rows_count, 0);
  assert.ok(preview.actions.some((action) => action.code === 'create_root'));
  const applied = repair.applyRepair(db, 2, {});
  assert.equal(applied.after.root_count, 1);
  assert.equal(applied.after.health.root_state, 'single');
  assert.ok(applied.validation.errors.some((message) => message.includes('1级') || message.includes('2级')));
  db.close();
});

test('BH.5 发布门禁：健康分不足拒绝发布；管理员 force 可强制发布', () => {
  const db = freshDb();
  const root = insert(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'ROOT' });
  const child = insert(db, { equipment_instance_id: 1, parent_id: root, tier: 1, quantity: 1, unit: '套', category: '自制部件', part_number: 'SUB', material_grade: 'Q235B', surface_treatment: '无' });
  insert(db, { equipment_instance_id: 1, parent_id: child, tier: 2, quantity: 1, unit: '件', category: '外购成品', part_number: 'LEAF', material_id: 1 });
  const old = process.env.BOM_RELEASE_MIN_SCORE;
  process.env.BOM_RELEASE_MIN_SCORE = '95';
  try {
    assert.throws(
      () => versions.createRelease(db, 1, { version: 'A1' }, 1),
      (error) => error.status === 400 && JSON.stringify(error.details || '').includes('健康分'),
    );
    const forced = versions.createRelease(db, 1, { version: 'A1', force: true }, 1, { uid: 1, role: 'admin', permissions: ['*'] });
    assert.equal(forced.forced, true);
    assert.equal(forced.status, 'released');
  } finally {
    if (old === undefined) delete process.env.BOM_RELEASE_MIN_SCORE;
    else process.env.BOM_RELEASE_MIN_SCORE = old;
  }
  db.close();
});
