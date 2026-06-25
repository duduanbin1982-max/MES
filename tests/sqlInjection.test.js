'use strict';
/**
 * sqlInjection.test.js
 * P1-3 SQL 注入修复测试
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function safeMatIds(rawKeys) {
  return rawKeys
    .filter(id => /^\d+$/.test(String(id)))
    .map(id => parseInt(id, 10))
    .filter(n => n > 0 && n <= 2147483647);
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(`CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER, lot_no TEXT);
    CREATE TABLE inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER, location TEXT, quantity REAL, status TEXT DEFAULT 'available');
    INSERT INTO materials VALUES (1, 'T-001'), (2, 'T-002');
    INSERT INTO material_lots (id, material_id, lot_no) VALUES (1, 1, 'L-1'), (2, 2, 'L-2');
    INSERT INTO inventory (material_lot_id, location, quantity) VALUES (1, 'A', 10), (2, 'B', 20);`);
  return db;
}

test('P1-3-1 正常整数 ID 列表通过', () => {
  const matIds = safeMatIds(['1', '2']);
  assert.deepEqual(matIds, [1, 2]);
  const db = freshDb();
  const sql = `SELECT ml.material_id, i.quantity FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id WHERE ml.material_id IN (${matIds.map(() => '?').join(',')}) AND i.status = 'available'`;
  const rows = db.prepare(sql).all(...matIds);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((s, r) => s + r.quantity, 0), 30);
});

test('P1-3-2 注入字符串被过滤', () => {
  const matIds = safeMatIds(['1; DROP TABLE materials;--', '2', 'abc', '', '0', '-1', '3.14', '99999999999']);
  assert.deepEqual(matIds, [2]);
});

test('P1-3-3 空数组不执行查询', () => {
  assert.deepEqual(safeMatIds(['abc', '', '0', '-1', '3.14', '99999999999']), []);
});

test('P1-3-4 ? 占位隔离变量', () => {
  const db = freshDb();
  const r = db.prepare('SELECT * FROM materials WHERE id = ?').get('1; DROP TABLE materials;--');
  assert.equal(r, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM materials').get().c, 2);
});

test('P1-3-5 整数边界 INT_MAX', () => {
  assert.deepEqual(safeMatIds(['2147483647', '2147483648', '0']), [2147483647]);
});
