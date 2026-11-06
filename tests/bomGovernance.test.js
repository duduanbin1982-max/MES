'use strict';

/**
 * bomGovernance.test.js
 * 2026-11-07 BOM 模块审计验证：
 *   B-1 权限（equipment/process/material write）——路由层由 apiPermissions 控制，见生产演练
 *   B-2 插入实例存在校验 + 负单价/负重量/替代优先级校验
 *   B-3 删除被工序节点引用保护（409，force 解除引用）
 *   B-4 成本汇总：非叶子节点子树成本按父数量放大
 *   B-5 CSV 导入默认原子回滚，allow_partial 保留逐行导入
 *   B-7 多根/悬空父节点迁移修复
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, name TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_instance_id INTEGER, bom_node_id INTEGER, operation_name TEXT);
    CREATE TABLE instance_bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER, parent_id INTEGER, tier INTEGER, version TEXT, eco_id INTEGER,
      effective_from TEXT, effective_to TEXT, material_id INTEGER, part_number TEXT, quantity REAL,
      unit TEXT, scrap_factor REAL, category TEXT, material_grade TEXT, surface_treatment TEXT,
      brand_recommend TEXT, brand_grade TEXT, is_alternative INTEGER, alternative_group TEXT,
      alternative_priority INTEGER, operation_id INTEGER, is_phantom INTEGER, is_key_component INTEGER,
      is_wear_part INTEGER, storage_location TEXT, unit_price REAL, weight REAL, notes TEXT,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT,
      node_type TEXT, level_code TEXT, sort_order INTEGER, view_flags TEXT,
      material_lot_id INTEGER, serial_id INTEGER
    );
  `);
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name, name) VALUES (1, 'TBM-1', '一号机', '一号机')").run();
  db.prepare("INSERT INTO materials (id, material_code, material_name) VALUES (1, 'M-1', '钢板'), (2, 'M-2', '螺栓')").run();
  return db;
}

function insertRow(db, row) {
  const columns = Object.keys(row);
  const stmt = db.prepare(`INSERT INTO instance_bom (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  return Number(stmt.run(...columns.map((key) => row[key])).lastInsertRowid);
}

let db;
test.beforeEach(() => { db = freshDb(); });

test('B-2 负单价/负重量/非法替代优先级被拒', () => {
  const { validateNode } = require('../services/bomService');
  const result = validateNode({ tier: 2, quantity: 1, unit: '件', category: '外购成品', part_number: 'X', unit_price: -1, weight: -2, alternative_priority: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('unit_price')));
  assert.ok(result.errors.some((error) => error.includes('weight')));
  assert.ok(result.errors.some((error) => error.includes('alternative_priority')));
});

test('B-2 插入 BOM：实例不存在返回 404', () => {
  const { insertBomNode } = require('../services/bom/service/mutations');
  assert.throws(
    () => insertBomNode(db, 9999, { tier: 0, quantity: 1, unit: '台', category: '成品', part_number: 'X' }),
    (error) => error.status === 404,
  );
});

test('B-4 成本汇总：装配件数量>1 时子树成本按父数量放大', () => {
  const root = insertRow(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, category: '成品', unit: '台', scrap_factor: 1 });
  const assembly = insertRow(db, { equipment_instance_id: 1, parent_id: root, tier: 1, quantity: 2, category: '自制部件', unit: '套', scrap_factor: 1, unit_price: 0 });
  insertRow(db, { equipment_instance_id: 1, parent_id: assembly, tier: 2, quantity: 3, category: '外购成品', unit: '件', scrap_factor: 1, unit_price: 10 });
  insertRow(db, { equipment_instance_id: 1, parent_id: root, tier: 1, quantity: 1, category: '外购成品', unit: '件', scrap_factor: 1, unit_price: 5 });
  const { calcCost } = require('../services/bomService');
  const items = calcCost(db, 1);
  const byId = new Map(items.map((item) => [item.id, item]));
  assert.equal(byId.get(assembly).cost, 60, '2 套 × (3 件 × 10 元) = 60');
  assert.equal(byId.get(root).cost, 65, '根 = 60 + 1×5');
});

test('B-3 删除被工序节点引用的 BOM：409；force 解除引用后删除', () => {
  const { deleteBomNodeCascade } = require('../services/bom/service/mutations');
  const root = insertRow(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, category: '成品', unit: '台' });
  const child = insertRow(db, { equipment_instance_id: 1, parent_id: root, tier: 1, quantity: 1, category: '外购成品', unit: '件', part_number: 'P-1' });
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, bom_node_id, operation_name) VALUES (1, ?, '下料')").run(child);
  assert.throws(
    () => deleteBomNodeCascade(db, root),
    (error) => error.status === 409 && String(error.message).includes('工序节点'),
  );
  const result = deleteBomNodeCascade(db, root, { force: true });
  assert.equal(result.count, 2);
  assert.equal(result.cleared_process_nodes, 1);
  assert.equal(db.prepare('SELECT bom_node_id FROM process_nodes').get().bom_node_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM instance_bom').get().c, 0);
});

test('B-5 CSV 导入：默认原子回滚；allow_partial 逐行导入', () => {
  const { importBomCsv } = require('../services/bom/service/importer');
  const csv = [
    'tier,quantity,unit,category,part_number,parent_ref,node_ref,material_grade,surface_treatment',
    '0,1,台,成品,ROOT-PART,,R1,,',
    '1,1,套,自制部件,SUB-PART,R1,R2,45#,喷漆',
    '2,-1,件,外购成品,LEAF,R2,R3,,',
  ].join('\n');
  assert.throws(
    () => importBomCsv(db, 1, csv),
    (error) => error.status === 400 && String(error.message).includes('已全部回滚'),
  );
  assert.equal(db.prepare('SELECT COUNT(*) c FROM instance_bom').get().c, 0, '失败时不应写入任何行');
  const partial = importBomCsv(db, 1, csv, null, { allow_partial: true });
  assert.equal(partial.inserted, 2);
  assert.equal(partial.errors, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM instance_bom').get().c, 2);
});

test('B-7 迁移：多根 + 悬空父节点修复为单根树', () => {
  const { plan, apply } = require('../scripts/migrate-bom-integrity');
  const root = insertRow(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, category: '成品', unit: '台' });
  const extraRoot = insertRow(db, { equipment_instance_id: 1, parent_id: null, tier: 0, quantity: 1, category: '外购成品', unit: '件' });
  const dangling = insertRow(db, { equipment_instance_id: 1, parent_id: 99999, tier: 2, quantity: 1, category: '外购成品', unit: '件' });
  const planData = plan(db);
  assert.ok(planData.reports.some((report) => report.issue === 'multiple_roots'));
  assert.ok(planData.reports.some((report) => report.issue === 'dangling_parent'));
  assert.equal(apply(db, planData), 2);
  const roots = db.prepare('SELECT id FROM instance_bom WHERE equipment_instance_id=1 AND parent_id IS NULL').all();
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, root);
  assert.equal(db.prepare('SELECT parent_id FROM instance_bom WHERE id=?').get(extraRoot).parent_id, root);
  assert.equal(db.prepare('SELECT parent_id FROM instance_bom WHERE id=?').get(dangling).parent_id, root);
});
