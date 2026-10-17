"use strict";
// tests/workflowTimeline.test.js
// 2026-10-17 统一读取口径：工单 / ECO / 文档 三种审计源归一成同一形状。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const timeline = require("../services/workflow/timeline");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, title TEXT, status TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, doc_no TEXT, doc_name TEXT, title TEXT, status TEXT);
    CREATE TABLE workflow_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, definition_name TEXT, entity_type TEXT, entity_id INTEGER,
      current_state TEXT, assigned_to INTEGER, priority INTEGER DEFAULT 0, due_date TEXT, data TEXT,
      started_at TEXT DEFAULT (datetime('now')), completed_at TEXT, created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE workflow_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id INTEGER, from_state TEXT, to_state TEXT,
      action TEXT, actor_id INTEGER, comment TEXT, data TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE document_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, action TEXT NOT NULL,
      from_status TEXT, to_status TEXT, version TEXT, issued_to TEXT, reason TEXT,
      operator_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, full_name) VALUES (1, '张三'), (2, '李四');
    INSERT INTO work_orders (id, wo_code, title, status) VALUES (1, 'WO-1', '工单一', 'in_progress');
    INSERT INTO documents (id, doc_no, doc_name, title, status) VALUES (7, 'DOC-7', '作业指导书', '作业指导书V2', 'issued');
    INSERT INTO workflow_instances (id, definition_name, entity_type, entity_id, current_state)
      VALUES (1, 'work_order', 'work_order', 1, 'in_progress'),
             (2, 'eco_change', 'eco', 5, 'review');
    INSERT INTO workflow_history (instance_id, from_state, to_state, action, actor_id, comment, created_at)
      VALUES (1, NULL, 'pending', 'start', 1, '工单创建', '2026-10-17 09:00:00'),
             (1, 'pending', 'dispatched', 'dispatch', 1, '派工', '2026-10-17 10:00:00'),
             (1, 'dispatched', 'in_progress', 'start', 2, NULL, '2026-10-17 11:00:00'),
             (2, 'open', 'review', 'submit', 1, '提交评审', '2026-10-16 15:00:00');
    INSERT INTO document_events (doc_id, action, from_status, to_status, version, issued_to, reason, operator_id, created_at)
      VALUES (7, 'upload', NULL, 'draft', 'V1', NULL, NULL, 1, '2026-10-15 08:00:00'),
             (7, 'issue', 'draft', 'issued', 'V2', 'production', NULL, 2, '2026-10-17 08:30:00');
  `);
  return db;
}

test("TL.1 工单：workflow_instances/history → 统一 history（倒序 + 标签 + 操作人）", () => {
  const db = freshDb();
  const t = timeline.getTimeline(db, "work_order", 1);
  assert.equal(t.entity_type, "work_order");
  assert.equal(t.definition, "work_order");
  assert.equal(t.current_state, "in_progress");
  assert.deepEqual(t.sources, ["workflow_instances"]);
  assert.deepEqual(t.history.map((h) => h.action), ["start", "dispatch", "start"], "最新在前");
  assert.equal(t.history[0].action_label, "开工");
  assert.equal(t.history[0].actor_name, "李四");
  assert.equal(t.history[1].comment, "派工");
  assert.equal(t.entity.wo_code, "WO-1");
  const acts = t.available_actions.map((a) => a.action).sort();
  assert.deepEqual(acts, ["cancel", "complete", "pause", "report"]);
  db.close();
});

test("TL.2 文档：document_events → 统一 history（source 标注 + issued_to 作为备注）", () => {
  const db = freshDb();
  const t = timeline.getTimeline(db, "document", 7);
  assert.equal(t.definition, "document_issue");
  assert.equal(t.current_state, "issued");
  assert.deepEqual(t.sources, ["document_events"]);
  assert.deepEqual(t.history.map((h) => h.action), ["issue", "upload"]);
  assert.equal(t.history[0].from_state, "draft");
  assert.equal(t.history[0].to_state, "issued");
  assert.equal(t.history[0].source, "document_events");
  assert.equal(t.history[0].action_label, "签发");
  assert.equal(t.history[0].actor_name, "李四");
  assert.match(t.history[0].comment, /production/);
  db.close();
});

test("TL.3 文档：可用动作由 document_issue 定义推导（issued → revoke/archive）", () => {
  const db = freshDb();
  const t = timeline.getTimeline(db, "document", 7);
  assert.deepEqual(t.available_actions.map((a) => a.action).sort(), ["archive", "revoke"]);
  // 改状态为 draft → issue/archive
  db.prepare("UPDATE documents SET status = 'draft' WHERE id = 7").run();
  const t2 = timeline.getTimeline(db, "document", 7);
  assert.deepEqual(t2.available_actions.map((a) => a.action).sort(), ["archive", "issue"]);
  // archived 终态 → 无动作
  db.prepare("UPDATE documents SET status = 'archived' WHERE id = 7").run();
  assert.deepEqual(timeline.getTimeline(db, "document", 7).available_actions, []);
  db.close();
});

test("TL.4 ECO：引擎实例 → 统一 history", () => {
  const db = freshDb();
  const t = timeline.getTimeline(db, "eco", 5);
  assert.equal(t.definition, "eco_change");
  assert.equal(t.current_state, "review");
  assert.deepEqual(t.sources, ["workflow_instances"]);
  assert.deepEqual(t.history.map((h) => h.action), ["submit"]);
  assert.deepEqual(t.available_actions.map((a) => a.action).sort(), ["approve", "reject"]);
  db.close();
});

test("TL.5 不存在的实体/未知类型：返回空结构而不抛错", () => {
  const db = freshDb();
  for (const [type, id] of [["work_order", 999], ["document", 999], ["eco", 999], ["nosuch", 1]]) {
    const t = timeline.getTimeline(db, type, id);
    assert.equal(t.entity_type, type);
    assert.deepEqual(t.history, []);
    assert.deepEqual(t.available_actions, []);
    assert.equal(t.current_state, null);
  }
  db.close();
});

test("TL.6 定义映射：每个 entity_type 只对应一个定义，且三实体都有定义", () => {
  const seen = new Map();
  for (const [name, def] of Object.entries(require("../app/workflow/definitions").definitions)) {
    assert.ok(!seen.has(def.entity_type), `entity_type 重复: ${def.entity_type}`);
    seen.set(def.entity_type, name);
  }
  for (const t of ["work_order", "eco", "document", "bom_node"]) {
    assert.ok(seen.has(t), "缺少定义: " + t);
  }
  const db = freshDb();
  assert.equal(timeline.definitionFor("document").name, "document_issue");
  assert.equal(timeline.definitionFor("nosuch").name, null);
  db.close();
});
