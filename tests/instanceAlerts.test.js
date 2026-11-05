"use strict";
// 2026-11-05（审计 F-07）：单项目告警接口测试
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { getInstanceAlerts } = require("../services/equipment/gantt/instanceGantt/alerts");

function makeDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT)");
  db.exec("CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, status TEXT, planned_start TEXT, planned_end TEXT, actual_start TEXT)");
  db.exec("CREATE TABLE instance_milestones (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, phase_code TEXT, phase_name TEXT, status TEXT, planned_start TEXT, planned_end TEXT)");
  db.exec("CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, wo_code TEXT, title TEXT, status TEXT, actual_start TEXT)");
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (1, 'T1', '一号机'), (2, 'T2', '二号机')").run();
  return db;
}

function call(db, id) {
  let captured = null;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { captured = { status: this.statusCode, body: payload }; return this; },
  };
  getInstanceAlerts({ params: { id: String(id) } }, res, db);
  return captured;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace("T", " ");

test("ALERT.1 工序超期按天数分级 + 已完��/已取消不算", () => {
  const db = makeDb();
  const ins = db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name, status, planned_start, planned_end) VALUES (?,?,?,?,?)");
  ins.run(1, "超期1天", "ready", daysAgo(5), daysAgo(1));
  ins.run(1, "超期5天", "in_progress", daysAgo(12), daysAgo(5));
  ins.run(1, "超期10天", "ready", daysAgo(20), daysAgo(10));
  ins.run(1, "已完成", "completed", daysAgo(20), daysAgo(15));
  const r = call(db, 1);
  assert.equal(r.status, 200);
  const overdue = r.body.alerts.filter((a) => a.type === "overdue_node");
  assert.equal(overdue.length, 3, "已完成节点不告警");
  assert.deepEqual(overdue.map((a) => a.severity), ["danger", "warning", "info"], "按 10天/5天/1天 分级并排序");
  assert.equal(r.body.by_severity.danger, 1);
  assert.equal(r.body.by_severity.warning, 1);
  assert.equal(r.body.by_severity.info, 1);
});

test("ALERT.2 受阻 / 未排程 / 里程碑延期 / 长运行工单", () => {
  const db = makeDb();
  const node = db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name, status, planned_start, planned_end) VALUES (?,?,?,?,?)");
  node.run(1, "受阻工序", "blocked", null, null);
  node.run(1, "未排工序", "ready", null, null);
  db.prepare("INSERT INTO instance_milestones (equipment_instance_id, phase_code, phase_name, status, planned_start, planned_end) VALUES (1,'P1','设计','in_progress',?,?)").run(daysAgo(40), daysAgo(12));
  db.prepare("INSERT INTO work_orders (equipment_instance_id, wo_code, title, status, actual_start) VALUES (1,'WO-1','长运行','in_progress',?)").run(daysAgo(45));
  const types = call(db, 1).body.alerts.map((a) => a.type);
  assert.ok(types.includes("blocked_node"));
  assert.ok(types.includes("unscheduled_node"));
  assert.ok(types.includes("overdue_milestone"));
  assert.ok(types.includes("long_running_work_order"));
});

test("ALERT.3 只统计本项目 + 实例不存在 404", () => {
  const db = makeDb();
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name, status, planned_start, planned_end) VALUES (2,'别项目超期','ready',?,?)").run(daysAgo(20), daysAgo(10));
  assert.equal(call(db, 1).body.count, 0, "别的项目告警不应出现");
  assert.equal(call(db, 2).body.count, 1);
  const missing = call(db, 999);
  assert.equal(missing.status, 404);
});
