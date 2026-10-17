require("dotenv").config();
"use strict";
// tests/workflow.test.js
// P0-5 工作流引擎测试

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

let db, wf;

test.before(() => {
  db = new Database(":memory:");
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, role TEXT);
    INSERT INTO users VALUES (1, '管理员', 'admin');
    INSERT INTO users VALUES (2, '工程师', 'engineer');

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      entity_type TEXT NOT NULL, description TEXT DEFAULT "",
      states TEXT NOT NULL, transitions TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_name TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL, current_state TEXT NOT NULL,
      assigned_to INTEGER, priority INTEGER DEFAULT 0,
      due_date TEXT, data TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT, created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL,
      from_state TEXT, to_state TEXT NOT NULL,
      action TEXT NOT NULL, actor_id INTEGER,
      comment TEXT, data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
  `);

  const { createEngine } = require("../app/workflow/engine");
  wf = createEngine(db);
});

// === ECO 工作流 ===
test("P5-1 启动 ECO 工作流", () => {
  const r = wf.start("eco_change", "eco", 1, {
    assigned_to: 2,
    data: { eco_no: "ECO-001", title: "测试变更" },
    created_by: 1,
    comment: "初始提交",
  });
  assert.equal(r.instance.current_state, "open");
  assert.equal(r.instance.entity_type, "eco");
  assert.equal(r.instance.entity_id, 1);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].action, "start");
});

test("P5-2 ECO 提交评审", () => {
wf.getInstance(1);
  const r = wf.transit(1, "submit", 1, "请审核");
  assert.equal(r.instance.current_state, "review");
  assert.equal(r.history.length, 2);
});

test("P5-3 ECO 批准 (需 effective_date)", () => {
  // 不带 effective_date 应被 guard 拦截
  assert.throws(() => wf.transit(1, "approve", 1, "OK"), /guard/);
  // 带 effective_date 应成功
  const r = wf.transit(1, "approve", 1, "批准", { effective_date: "2026-07-01" });
  assert.equal(r.instance.current_state, "approved");
});

test("P5-4 ECO 实施 + 关闭", () => {
  wf.transit(1, "implement", 1, "实施完毕");
  let inst = wf.getInstance(1);
  assert.equal(inst.current_state, "implemented");
  // 关闭需要 closed_date
  assert.throws(() => wf.transit(1, "close", 1, "close"), /guard/);
  wf.transit(1, "close", 1, "已关闭", { closed_date: "2026-07-15" });
  inst = wf.getInstance(1);
  assert.equal(inst.current_state, "closed");
  assert.ok(inst.completed_at);
  // 完成后不能再迁移
  assert.throws(() => wf.transit(1, "submit", 1, "xxx"), /已结束/);
});

// === 工单工作流 ===
test("P5-5 启动工单工作流 + 完整流转", () => {
  // 2026-10-13 决策②（选项 ii）：work_order 定义改为与 services/workOrder/stateMachine.js
  // 同源（pending/dispatched/in_progress/paused/completed/cancelled），
  // 不再使用旧的 created/released/resume/closed 那套。
  const r = wf.start("work_order", "work_order", 100, { created_by: 1 });
  assert.equal(r.instance.current_state, "pending");

  // pending -> dispatched（派工）
  wf.transit(r.instance.id, "dispatch", 1, "派工");
  assert.equal(wf.getInstance(r.instance.id).current_state, "dispatched");

  // dispatched -> in_progress（开工）
  wf.transit(r.instance.id, "start", 2, "开工");
  assert.equal(wf.getInstance(r.instance.id).current_state, "in_progress");

  // in_progress -> paused（缺料暂停）
  wf.transit(r.instance.id, "pause", 2, "缺料暂停");
  assert.equal(wf.getInstance(r.instance.id).current_state, "paused");

  // paused -> completed（complete 允许 DISPATCHED / IN_PROGRESS / PAUSED）
  wf.transit(r.instance.id, "complete", 2, "完工");
  assert.equal(wf.getInstance(r.instance.id).current_state, "completed");
});

test("P5-5b 工单流转定义与 stateMachine 同源（防漂移）", () => {
  const sm = require("../services/workOrder/stateMachine");
  const { definitions } = require("../app/workflow/definitions");
  const def = definitions.work_order;

  // 状态集合必须一致
  assert.deepEqual(def.states.map((s) => s.id), Object.values(sm.WO_STATUS));

  // (from, action) 组合必须一致：引擎定义由 from 数组展开，stateMachine 保留 from 数组
  const enginePairs = def.transitions.map((t) => `${t.from}|${t.action}`).sort();
  const smPairs = [];
  for (const [event, t] of Object.entries(sm.TRANSITIONS)) {
    for (const from of t.from) smPairs.push(`${from}|${event}`);
  }
  assert.deepEqual(enginePairs, smPairs.sort());

  // plan() 的结果必须仍是唯一来源（wf 定义直接来自 workOrderDefinition）
  const woDef = require("../app/workflow/workOrderDefinition");
  assert.equal(woDef.plan, sm.plan);
});

test("P5-6 非法迁移应报错", () => {
  const r = wf.start("work_order", "work_order", 200, { created_by: 1 });
  assert.throws(() => wf.transit(r.instance.id, "complete", 1, "跳过"), /不可执行/);
  assert.throws(() => wf.transit(r.instance.id, "approve", 1, "不存在的动作"), /不可执行/);
});

// === BOM 审批工作流 ===
test("P5-7 BOM 审批完整流程", () => {
  const r = wf.start("bom_approval", "bom_node", 50, { created_by: 1 });
  assert.equal(r.instance.current_state, "draft");

  wf.transit(r.instance.id, "submit", 1, "请审核");
  assert.equal(wf.getInstance(r.instance.id).current_state, "review");

  wf.transit(r.instance.id, "approve", 2, "批准");
  assert.equal(wf.getInstance(r.instance.id).current_state, "approved");

  wf.transit(r.instance.id, "release", 1, "发布到生产");
  assert.equal(wf.getInstance(r.instance.id).current_state, "released");

  // 作废
  wf.transit(r.instance.id, "obsolesce", 1, "版本过期");
  assert.equal(wf.getInstance(r.instance.id).current_state, "obsoleted");
});

test("P5-8 BOM 驳回 + 修改重提", () => {
  const r = wf.start("bom_approval", "bom_node", 51, { created_by: 1 });
  wf.transit(r.instance.id, "submit", 1, "请审核");
  wf.transit(r.instance.id, "reject", 2, "材质不对");
  assert.equal(wf.getInstance(r.instance.id).current_state, "rejected");
  // 修改重提
  wf.transit(r.instance.id, "revise", 1, "已改材质");
  assert.equal(wf.getInstance(r.instance.id).current_state, "draft");
});

test("P5-9 getAvailableActions", () => {
  const r = wf.start("eco_change", "eco", 99, { created_by: 1 });
  let actions = wf.getAvailableActions(r.instance.id);
  assert.ok(actions.some(a => a.action === "submit"));
  assert.ok(actions.some(a => a.action === "reject"));
  assert.equal(actions.every(a => a.from !== "review"), true);

  wf.transit(r.instance.id, "submit", 1, "review");
  actions = wf.getAvailableActions(r.instance.id);
  assert.ok(actions.some(a => a.action === "approve"));
  assert.ok(actions.some(a => a.action === "reject"));
});

test("P5-10 getInstancesByEntity", () => {
wf.start("eco_change", "eco", 500, { created_by: 1 });
  const r2 = wf.start("eco_change", "eco", 500, { created_by: 1 });
  const list = wf.getInstancesByEntity("eco", 500);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, r2.instance.id);
});

test("P5-11 错误的 definition_name", () => {
  assert.throws(() => wf.start("no_such_wf", "test", 1, {}), /未知工作流/);
});

test("P5-12 entity_type 不匹配", () => {
  assert.throws(() => wf.start("eco_change", "wrong_type", 1, {}), /不匹配/);
});
