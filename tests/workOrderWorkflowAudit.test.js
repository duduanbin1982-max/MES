"use strict";
// tests/workOrderWorkflowAudit.test.js
// 2026-10-13 决策②（选项 ii）后半段：工单流转写入工作流审计流水。
// 分工：work_orders.status 由 stateMachine 写；workflow_instances/history 由 workflowAudit 写。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const audit = require("../services/workOrder/workflowAudit");
const sm = require("../services/workOrder/stateMachine");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wo_code TEXT UNIQUE NOT NULL,
      equipment_instance_id INTEGER,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      dispatched_at TEXT,
      actual_start TEXT,
      actual_end TEXT,
      actual_hours REAL DEFAULT 0,
      quantity_planned INTEGER DEFAULT 1,
      quantity_completed INTEGER DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_name TEXT, entity_type TEXT, entity_id INTEGER, current_state TEXT,
      assigned_to INTEGER, priority INTEGER DEFAULT 0, due_date TEXT, data TEXT,
      started_at TEXT DEFAULT (datetime('now')), completed_at TEXT, created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE workflow_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER, from_state TEXT, to_state TEXT, action TEXT, actor_id INTEGER,
      comment TEXT, data TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, full_name) VALUES (1, '张三');
    INSERT INTO work_orders (id, wo_code, equipment_instance_id, title, status)
      VALUES (1, 'WO-1', 1, '测试工单', 'pending');
  `);
  return db;
}

const runner = (db) => (sql, params) => db.prepare(sql).run(params);
const wo = (db) => db.prepare("SELECT * FROM work_orders WHERE id = 1").get();
const history = (db) =>
  db.prepare("SELECT * FROM workflow_history ORDER BY id").all();
const instances = (db) =>
  db.prepare("SELECT * FROM workflow_instances ORDER BY id").all();

test("WA.1 创建工单即启动实例，重复调用不会重复建实例", () => {
  const db = freshDb();
  const id1 = audit.startInstance(db, wo(db), 1);
  const id2 = audit.startInstance(db, wo(db), 1);
  assert.ok(id1);
  assert.equal(id1, id2);
  const list = instances(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].current_state, "pending");
  assert.equal(list[0].definition_name, "work_order");
  assert.equal(list[0].entity_type, "work_order");
  assert.equal(list[0].entity_id, 1);
  const h = history(db);
  assert.equal(h.length, 1);
  assert.equal(h[0].action, "start");
  assert.equal(h[0].from_state, null);
  assert.equal(h[0].to_state, "pending");
  db.close();
});

test("WA.2 dispatch：业务状态与审计流水同步推进", () => {
  const db = freshDb();
  const run = runner(db);
  audit.startInstance(db, wo(db), 1);
  const before = wo(db);
  const to = sm.apply(before, "dispatch", {}, run);
  const instId = audit.recordTransition(db, before, "dispatch", before.status, to, 1, "派工给张三");

  assert.equal(to, "dispatched");
  assert.equal(wo(db).status, "dispatched");
  assert.ok(wo(db).dispatched_at, "dispatched_at 应写入");

  const h = history(db);
  const last = h[h.length - 1];
  assert.equal(last.action, "dispatch");
  assert.equal(last.from_state, "pending");
  assert.equal(last.to_state, "dispatched");
  assert.equal(last.comment, "派工给张三");
  assert.equal(instances(db)[0].current_state, "dispatched");
  assert.equal(instId, instances(db)[0].id);
  db.close();
});

test("WA.3 report：不足计划量保持状态，达到计划量自动完工并记录 completed_at", () => {
  const db = freshDb();
  const run = runner(db);
  audit.startInstance(db, wo(db), 1);
  let cur = wo(db);
  let to = sm.apply(cur, "start", {}, run); // pending -> in_progress
  audit.recordTransition(db, cur, "start", cur.status, to, 1, null);

  // 计划 10，先报 4
  db.prepare("UPDATE work_orders SET quantity_planned = 10 WHERE id = 1").run();
  cur = wo(db);
  to = sm.apply(cur, "report", { quantity_completed: 4, hours_worked: 2 }, run);
  audit.recordTransition(db, cur, "report", cur.status, to, 1, null, { quantity_completed: 4, hours_worked: 2 });
  assert.equal(to, "in_progress", "未达计划量应保持 in_progress");
  assert.equal(wo(db).quantity_completed, 4);

  // 再报 6，达到 10 -> completed
  cur = wo(db);
  to = sm.apply(cur, "report", { quantity_completed: 6, hours_worked: 3 }, run);
  audit.recordTransition(db, cur, "report", cur.status, to, 1, null, { quantity_completed: 6, hours_worked: 3 });
  assert.equal(to, "completed");
  assert.equal(wo(db).status, "completed");
  assert.ok(wo(db).actual_end);
  assert.ok(instances(db)[0].completed_at, "终态应写 completed_at");

  const actions = history(db).map((h) => h.action);
  assert.deepEqual(actions, ["start", "start", "report", "report"]);
  db.close();
});

test("WA.4 历史工单没有实例时懒创建，并把实例状态对齐到工单当前状态", () => {
  const db = freshDb();
  db.prepare("UPDATE work_orders SET status = 'in_progress' WHERE id = 1").run();
  const cur = wo(db);
  const to = sm.apply(cur, "complete", {}, runner(db));
  audit.recordTransition(db, cur, "complete", cur.status, to, 1, "补录");

  const list = instances(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].current_state, "completed");
  const h = history(db);
  assert.equal(h.length, 2); // start + complete
  assert.equal(h[1].from_state, "in_progress");
  assert.equal(h[1].to_state, "completed");
  db.close();
});

test("WA.5 getTimeline 返回实例、历史与当前可用动作", () => {
  const db = freshDb();
  const run = runner(db);
  audit.startInstance(db, wo(db), 1);
  // pending -> dispatched -> in_progress
  let cur = wo(db);
  let to = sm.apply(cur, "dispatch", {}, run);
  audit.recordTransition(db, cur, "dispatch", cur.status, to, 1, null);
  cur = wo(db);
  to = sm.apply(cur, "start", {}, run);
  audit.recordTransition(db, cur, "start", cur.status, to, 1, null);

  const t = audit.getTimeline(db, 1);
  assert.equal(t.entity_type, "work_order");
  assert.equal(t.entity_id, 1);
  assert.equal(t.current_state, "in_progress");
  assert.equal(t.instances.length, 1);
  assert.equal(t.instances[0].history.length, 3); // start + dispatch + start
  const acts = t.available_actions.map((a) => a.action).sort();
  assert.deepEqual(acts, ["cancel", "complete", "pause", "report"]);

  // 不存在的工单
  const empty = audit.getTimeline(db, 999);
  assert.equal(empty.work_order, null);
  assert.deepEqual(empty.instances, []);
  db.close();
});

test("WA.6 审计失败不影响业务：表缺失时返回 null 且不抛异常", () => {
  const db = freshDb();
  db.exec("DROP TABLE workflow_history");
  const cur = wo(db);
  const to = sm.apply(cur, "dispatch", {}, runner(db));
  assert.equal(to, "dispatched", "业务状态照常推进");

  let result;
  assert.doesNotThrow(() => {
    result = audit.recordTransition(db, cur, "dispatch", cur.status, to, 1, null);
  });
  assert.equal(result, null);
  assert.equal(wo(db).status, "dispatched");
  db.close();
});
