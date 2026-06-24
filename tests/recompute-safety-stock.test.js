// tests/recompute-safety-stock.test.js
// P2-10 安全库存自动计算
//   算法: 90 天日均消耗 * 7 (7 天缓冲) -> materials.safety_stock
//   通过 DB_PATH 环境变量注入 in-memory db (better-sqlite3 不支持 :memory: 作为路径, 改用临时文件)
// Author: 三狗子 | Date: 2026-06-25
"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');

function freshDbFile() {
  const tmp = path.join(os.tmpdir(), 'recompute-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.db');
  const db = new Database(tmp);
  db.exec("CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT UNIQUE NOT NULL, material_name TEXT NOT NULL, unit TEXT, safety_stock REAL DEFAULT 0, reorder_point REAL DEFAULT 0)");
  db.exec("CREATE TABLE material_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL, lot_no TEXT NOT NULL, quantity REAL, unit TEXT)");
  db.exec("CREATE TABLE material_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, material_lot_id INTEGER NOT NULL, movement_type TEXT NOT NULL, quantity REAL, unit TEXT, from_location TEXT, to_location TEXT, work_order_id INTEGER, created_at TEXT DEFAULT '2026-01-01 00:00:00')");
  db.close();
  return tmp;
}

function runScript(dbPath) {
  const script = '/home/dubin/factory-mes/scripts/recompute-safety-stock.js';
  const node = '/home/dubin/.nvm/versions/node/v22.22.3/bin/node';
  try {
    return execFileSync(node, [script], { cwd: '/home/dubin/factory-mes', env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', timeout: 30000 });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

test('P2-10-1 90 天日均 × 7 = safety_stock', () => {
  const dbPath = freshDbFile();
  try {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO materials (id, material_code, material_name, unit, safety_stock) VALUES (1, 'M-1', '测试物料', '件', 100)").run();
    db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (1, 1, 'L-1', 1000)").run();
    db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, created_at) VALUES (1, 'issue', 300, datetime('now', '-30 days'))").run();
    db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, created_at) VALUES (1, 'issue', 600, datetime('now', '-60 days'))").run();
    db.close();
    runScript(dbPath);
    const db2 = new Database(dbPath, { readonly: true });
    const m = db2.prepare("SELECT safety_stock, reorder_point FROM materials WHERE id = 1").get();
    db2.close();
    assert.equal(m.safety_stock, 70, 'safety_stock 应 = 70');
    assert.equal(m.reorder_point, 56, 'reorder_point 应 = 56');
  } finally { try { fs.unlinkSync(dbPath); } catch(e){} }
});

test('P2-10-2 90 天无消耗, safety_stock 不变', () => {
  const dbPath = freshDbFile();
  try {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO materials (id, material_code, material_name, unit, safety_stock) VALUES (1, 'M-1', '无消耗', '件', 50)").run();
    db.close();
    runScript(dbPath);
    const db2 = new Database(dbPath, { readonly: true });
    const m = db2.prepare("SELECT safety_stock FROM materials WHERE id = 1").get();
    db2.close();
    assert.equal(m.safety_stock, 50, '无消耗保持原值');
  } finally { try { fs.unlinkSync(dbPath); } catch(e){} }
});

test('P2-10-3 safety_stock=0 不参与计算', () => {
  const dbPath = freshDbFile();
  try {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO materials (id, material_code, material_name, unit, safety_stock) VALUES (1, 'M-1', '禁用', '件', 0)").run();
    db.prepare("INSERT INTO material_lots (id, material_id, lot_no, quantity) VALUES (1, 1, 'L-1', 1000)").run();
    db.prepare("INSERT INTO material_movements (material_lot_id, movement_type, quantity, created_at) VALUES (1, 'issue', 1000, datetime('now', '-30 days'))").run();
    db.close();
    runScript(dbPath);
    const db2 = new Database(dbPath, { readonly: true });
    const m = db2.prepare("SELECT safety_stock FROM materials WHERE id = 1").get();
    db2.close();
    assert.equal(m.safety_stock, 0, '禁用库存保持 0');
  } finally { try { fs.unlinkSync(dbPath); } catch(e){} }
});
