"use strict";
// tests/workOrdersStatusCheck.test.js
// W2-2：work_orders.status 的 DB 级 CHECK 约束（2026-10-17）
// 用迁移脚本导出的 DDL 在内存库上验证，不需要生产库。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { NEW_DDL, INDEXES, STATUSES, applyMigration, hasCheck } = require("../scripts/migrate-wo-status-check");
const { WO_STATUS } = require("../services/workOrder/stateMachine");

function legacyDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT);
    CREATE TABLE instance_milestones (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE equipment_subsystems (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_code TEXT UNIQUE NOT NULL,
      equipment_instance_id INTEGER NOT NULL,
      milestone_id INTEGER,
      subsystem_id INTEGER,
      parent_wo_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      workstation_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 3,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      estimated_hours REAL,
      actual_hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_to INTEGER REFERENCES users(id),
      dispatched_at TEXT,
      quantity_planned INTEGER DEFAULT 1,
      quantity_completed INTEGER DEFAULT 0,
      FOREIGN KEY (equipment_instance_id) REFERENCES "equipment_instances"(id) ON DELETE CASCADE,
      FOREIGN KEY (milestone_id) REFERENCES "instance_milestones"(id),
      FOREIGN KEY (subsystem_id) REFERENCES "equipment_subsystems"(id),
      FOREIGN KEY (parent_wo_id) REFERENCES work_orders(id),
      FOREIGN KEY (workstation_id) REFERENCES workstations(id)
    );
    CREATE INDEX idx_work_orders_subsystem ON work_orders(subsystem_id);
    CREATE INDEX idx_wo_status ON work_orders(status);
    CREATE INDEX idx_wo_instance ON work_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL;
    INSERT INTO users (id, full_name) VALUES (1, '张三');
    INSERT INTO equipment_instances (id, instance_code) VALUES (1, 'SN-1');
    INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES
      ('WO-1', 1, '工单一', 'pending'),
      ('WO-2', 1, '工单二', 'in_progress'),
      ('WO-3', 1, '工单三', 'completed');
    UPDATE sqlite_sequence SET seq = 9 WHERE name = 'work_orders';
  `);
  return db;
}

test("W2C.1 迁移前：无 CHECK 约束，非法状态可以被写入（证明问题存在）", () => {
  const db = legacyDb();
  assert.equal(hasCheck(db), false);
  const r = db.prepare("INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES (?, 1, ?, ?)")
    .run("WO-BAD", "坏数据", "bogus_status");
  assert.ok(r.lastInsertRowid);
  db.close();
});

test("W2C.2 迁移：保留数据/序列/索引，并建立 CHECK 约束", () => {
  const db = legacyDb();
  const before = db.prepare("SELECT COUNT(*) c FROM work_orders").get().c;
  const res = applyMigration(db);
  assert.equal(res.status, "applied");
  assert.equal(hasCheck(db), true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM work_orders").get().c, before, "行数不变");

  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'work_orders'").get().seq;
  assert.equal(seq, 9, "AUTOINCREMENT 序列不倒退");

  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='work_orders'").all();
  const names = idx.map((i) => i.name);
  for (const need of ["idx_wo_status", "idx_wo_instance", "idx_work_orders_subsystem"]) {
    assert.ok(names.includes(need), "缺少索引 " + need);
  }
  const partial = idx.find((i) => i.name === "idx_wo_instance");
  assert.match(partial.sql, /WHERE equipment_instance_id IS NOT NULL/i, "部分索引的 WHERE 必须保留");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});

test("W2C.3 迁移后：非法状态被拒绝，合法状态可写入", () => {
  const db = legacyDb();
  applyMigration(db);
  assert.throws(
    () => db.prepare("INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES (?, 1, ?, ?)")
      .run("WO-BAD", "坏数据", "bogus_status"),
    /CHECK constraint failed/i,
  );
  for (const s of STATUSES) {
    const code = "WO-OK-" + s;
    assert.ok(
      db.prepare("INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES (?, 1, ?, ?)")
        .run(code, "合法状态 " + s, s).lastInsertRowid > 0,
      "合法状态应可写入: " + s,
    );
  }
  db.close();
});

test("W2C.4 幂等：重复执行返回 already_applied", () => {
  const db = legacyDb();
  assert.equal(applyMigration(db).status, "applied");
  assert.equal(applyMigration(db).status, "already_applied");
  db.close();
});

test("W2C.5 子表外键在重建后仍指向 work_orders（级联仍生效）", () => {
  const db = legacyDb();
  db.exec(`
    CREATE TABLE work_order_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      action TEXT,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
    );
    INSERT INTO work_order_operations (work_order_id, action) VALUES (1, 'start'), (2, 'start');
  `);
  applyMigration(db);
  const fks = db.prepare("PRAGMA foreign_key_list(work_order_operations)").all();
  assert.equal(fks[0].table, "work_orders");
  assert.equal(fks[0].on_delete, "CASCADE");
  // 删除工单应级联删除工序
  db.prepare("DELETE FROM work_orders WHERE id = 1").run();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM work_order_operations WHERE work_order_id = 1").get().c, 0);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});

test("W2C.6 CHECK 的取值集合与状态机 WO_STATUS 完全一致（防漂移）", () => {
  const fromDdl = NEW_DDL.match(/CHECK \(status IN \(([^)]+)\)\)/)[1]
    .split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  assert.deepEqual(fromDdl.sort(), Object.values(WO_STATUS).sort());
  assert.equal(INDEXES.length, 3);
});
