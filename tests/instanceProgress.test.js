"use strict";
// tests/instanceProgress.test.js
// 2026-11-02：项目进度回写（视图公式 + 触发器回写 + 补数接口）
//
// 口径：pct = Σ(工序 estimated_hours × 完成度) / Σ estimated_hours
//       完成度 completed=100 / in_progress=50 / 其它 0
//       没有工序 → 退化为工单完成率

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { initInstanceProgressModel } = require("../services/equipment/progressModel");
const { recalcInstanceProgress, recalcAllInstances } = require("../services/equipment/progress");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, progress_pct INTEGER, updated_at TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT, estimated_hours REAL);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT);
  `);
  db.exec("INSERT INTO equipment_instances (id, instance_code, progress_pct) VALUES (1, 'T-001', 0), (2, 'T-002', 0)");
  assert.equal(initInstanceProgressModel(db), true);
  return db;
}

function pct(db, id = 1) {
  return db.prepare("SELECT progress_pct FROM equipment_instances WHERE id = ?").get(id).progress_pct;
}

function calc(db, id = 1) {
  return db.prepare("SELECT * FROM v_instance_progress_calc WHERE instance_id = ?").get(id);
}

test("IP.1 模型创建幂等：1 个视图 + 6 个触发器", () => {
  const db = freshDb();
  initInstanceProgressModel(db); // 再跑一次不应报错
  const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(views, ["v_instance_progress_calc"]);
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(triggers, [
    "trg_progress_nodes_ad",
    "trg_progress_nodes_ai",
    "trg_progress_nodes_au",
    "trg_progress_wo_ad",
    "trg_progress_wo_ai",
    "trg_progress_wo_au",
  ]);
  db.close();
});

test("IP.2 没有工序也没有工单 → 0 分，source=none", () => {
  const db = freshDb();
  const c = calc(db);
  assert.equal(c.pct, 0);
  assert.equal(c.source, "none");
  assert.equal(pct(db), 0);
  db.close();
});

test("IP.3 没有工序时退化为工单完成率（1/2 = 50）", () => {
  const db = freshDb();
  db.exec("INSERT INTO work_orders (id, equipment_instance_id, status) VALUES (1, 1, 'completed'), (2, 1, 'in_progress')");
  const c = calc(db);
  assert.equal(c.source, "work_orders");
  assert.equal(c.pct, 50, "1 张完成 / 2 张 = 50%");
  assert.equal(pct(db), 50, "触发器应已回写");
  db.close();
});

test("IP.4 工序按标准工时加权：10h 完成 + 30h 未开工 → 25%", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', 10), (2, 1, 'pending', 30)");
  const c = calc(db);
  assert.equal(c.source, "process_nodes");
  assert.equal(c.pct, 25);
  assert.equal(pct(db), 25);
  db.close();
});

test("IP.5 进行中按 50% 计：10h 进行中 + 10h 未开工 → 25%", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'in_progress', 10), (2, 1, 'pending', 10)");
  assert.equal(calc(db).pct, 25);
  db.close();
});

test("IP.6 缺标准工时时按 1 计（不因缺工时算成 0 权重）", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', NULL), (2, 1, 'pending', NULL)");
  assert.equal(calc(db).pct, 50, "两个等权工序，一个完成 → 50%");
  db.close();
});

test("IP.7 触发器：插入/更新/删除工序都会自动回写进度", () => {
  const db = freshDb();
  // 插入：1 完成 1 未开工，各 10h → 50
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', 10), (2, 1, 'pending', 10)");
  assert.equal(pct(db), 50, "INSERT 后应回写");
  // 更新：第二道也完成 → 100
  db.prepare("UPDATE process_nodes SET status = 'completed' WHERE id = 2").run();
  assert.equal(pct(db), 100, "UPDATE 后应回写");
  // 删除：删掉一道 → 仍 100（只剩一道且已完成）
  db.prepare("DELETE FROM process_nodes WHERE id = 2").run();
  assert.equal(pct(db), 100);
  // 再删掉最后一道 → 无工序无工单 → 0
  db.prepare("DELETE FROM process_nodes WHERE id = 1").run();
  assert.equal(pct(db), 0, "DELETE 后应回写为 0");
  db.close();
});

test("IP.8 触发器：无工序时工单状态变化也会回写", () => {
  const db = freshDb();
  db.exec("INSERT INTO work_orders (id, equipment_instance_id, status) VALUES (1, 1, 'in_progress')");
  assert.equal(pct(db), 0);
  db.prepare("UPDATE work_orders SET status = 'completed' WHERE id = 1").run();
  assert.equal(pct(db), 100, "工单完成后进度应回写 100");
  db.close();
});

test("IP.9 进度没变时不写库（不动 updated_at）", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', 10)");
  const before = db.prepare("SELECT updated_at FROM equipment_instances WHERE id = 1").get().updated_at;
  db.prepare("UPDATE process_nodes SET estimated_hours = 10 WHERE id = 1").run(); // 值没变
  const after = db.prepare("SELECT updated_at FROM equipment_instances WHERE id = 1").get().updated_at;
  assert.equal(after, before, "进度未变化不应刷新 updated_at");
  db.close();
});

test("IP.10 补数：recalcInstanceProgress 幂等，recalcAllInstances 统计变化", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', 10)");
  // 人为把进度写错，模拟历史脏数据
  db.exec("UPDATE equipment_instances SET progress_pct = 0 WHERE id = 1");
  const first = recalcInstanceProgress(db, 1);
  assert.equal(first.found, true);
  assert.equal(first.previous, 0);
  assert.equal(first.pct, 100);
  assert.equal(first.changed, true);
  const second = recalcInstanceProgress(db, 1);
  assert.equal(second.changed, false, "第二次不应再写");
  const all = recalcAllInstances(db);
  assert.equal(all.total, 2);
  assert.equal(all.changed, 0, "全部已是最新");
  db.close();
});

test("IP.11 工序换归属实例：两个实例都会被重算", () => {
  const db = freshDb();
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, estimated_hours) VALUES (1, 1, 'completed', 10)");
  assert.equal(pct(db, 1), 100);
  db.prepare("UPDATE process_nodes SET equipment_instance_id = 2 WHERE id = 1").run();
  assert.equal(pct(db, 1), 0, "旧实例应回到 0");
  assert.equal(pct(db, 2), 100, "新实例应变成 100");
  db.close();
});

test("IP.12 缺表时跳过建模（精简测试库不报错）", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, progress_pct INTEGER)");
  assert.equal(initInstanceProgressModel(db), false, "缺 process_nodes/work_orders 时应跳过");
  db.close();
});
