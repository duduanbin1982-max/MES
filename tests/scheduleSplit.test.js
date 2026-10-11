"use strict";
// services/schedule/ 拆分的回归守卫 (2026-10-11)
//
// scheduleService 原本只有 { register }，6 条路由 + 建表 + 迁移都在一个文件里。
// 这里既比对路由清单，也真的走一遍"派工 -> 产能 -> 我的任务 -> 完成"，
// 确保拆出来的 helpers/schema 与原有语义一致（尤其是 rest 参数的 all/get/run）。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "schedule");
const schedule = require("../services/schedule");

const EXPECTED_ROUTES = [
  ["GET", "/api/schedule/weekly"],
  ["PUT", "/api/schedule/process-nodes/:id/assign"],
  ["PUT", "/api/schedule/process-nodes/:id/status"],
  ["GET", "/api/schedule/capacity"],
  ["GET", "/api/schedule/daily"],
  ["GET", "/api/schedule/my-tasks"],
];

function makeApp() {
  const routes = [];
  const push = (method) => (routePath, handler) => routes.push({ method, path: routePath, handler });
  return { routes, get: push("GET"), put: push("PUT"), post: push("POST"), delete: push("DELETE") };
}

function callRoute(app, method, routePath, req) {
  const route = app.routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `route not registered: ${method} ${routePath}`);
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ ok: true, res: this });
        return this;
      },
    };
    route.handler({ query: {}, body: {}, params: {}, ...req }, res, (err) => resolve({ ok: false, err }));
  });
}

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence INTEGER,
      operation_name TEXT,
      status TEXT,
      planned_start TEXT,
      planned_end TEXT,
      estimated_hours REAL,
      phase_code TEXT,
      equipment_instance_id INTEGER,
      assigned_to INTEGER,
      required_workstation_id INTEGER,
      actual_start TEXT,
      actual_end TEXT,
      updated_at TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1, capacity_per_day REAL);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);
  `);
  db.prepare("INSERT INTO process_nodes (id, sequence, operation_name, status, estimated_hours, equipment_instance_id) VALUES (1, 1, '焊接', 'pending', 6, 100)").run();
  db.prepare("INSERT INTO users (id, full_name, is_active) VALUES (5, '张三', 1)").run();
  db.prepare("INSERT INTO workstations (id, name, is_active, capacity_per_day) VALUES (9, '工位A', 1, 1)").run();
  db.prepare("INSERT INTO equipment_instances (id, instance_code, instance_name) VALUES (100, 'TBM-1', '一号机')").run();
  schedule.runMigration(db);
  return db;
}

test("SCHED.1 公共面保留 register，并额外暴露可测的内部件", () => {
  for (const name of ["register", "runMigration", "makeDbHelpers", "toInt", "normalizeDate"]) {
    assert.equal(typeof schedule[name], "function", `missing export: ${name}`);
  }
});

test("SCHED.2 拆分目录里每个相对 require 都能解析", () => {
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const missing = [];
  for (const file of fs.readdirSync(MODULE_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = fs
      .readFileSync(path.join(MODULE_DIR, file), "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const match of source.matchAll(requirePattern)) {
      const request = match[1];
      if (!request.startsWith(".")) continue;
      const base = path.resolve(MODULE_DIR, request);
      const resolved = ["", ".js", ".json", "/index.js"].some((suffix) => fs.existsSync(`${base}${suffix}`));
      if (!resolved) missing.push(`${file}: ${request}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("SCHED.3 register 装配的 6 条路由与拆分前逐条一致", () => {
  const db = makeDb();
  const app = makeApp();
  schedule.register(app, db);
  const sortKey = (item) => `${item.method} ${item.path}`;
  assert.deepEqual(app.routes.map(sortKey).sort(), EXPECTED_ROUTES.map(([m, p]) => `${m} ${p}`).sort());
  db.close();
});

test("SCHED.4 runMigration 建表并落下 partial unique index", () => {
  const db = makeDb();
  const index = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_schedule_assignments_active_node'")
    .get();
  assert.ok(index, "缺少 idx_schedule_assignments_active_node");
  assert.match(index.sql, /CREATE UNIQUE INDEX/i);
  assert.match(index.sql, /WHERE status IN \('assigned', 'in_progress', 'pending'\)/);

  // 同一 process_node 只能有一条进行中的派工
  const insert = db.prepare(
    "INSERT INTO schedule_assignments (process_node_id, user_id, status) VALUES (1, 5, 'assigned')"
  );
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE|constraint/i);
  db.close();
});

test("SCHED.5 派工 → 产能 → 我的任务 → 完成 全链路行为一致", async () => {
  const db = makeDb();
  const app = makeApp();
  schedule.register(app, db);

  // 1) 派工 (date-only, 与 capacity 的字典序比较口径一致)
  const assigned = await callRoute(app, "PUT", "/api/schedule/process-nodes/:id/assign", {
    params: { id: "1" },
    body: { user_id: 5, workstation_id: 9, planned_start: "2026-10-11", planned_end: "2026-10-11" },
  });
  assert.equal(assigned.ok, true, assigned.err && assigned.err.message);
  assert.equal(assigned.res.body.ok, true);
  assert.ok(assigned.res.body.assignment_id);

  const node = db.prepare("SELECT * FROM process_nodes WHERE id = 1").get();
  assert.equal(node.assigned_to, 5);
  assert.equal(node.required_workstation_id, 9);
  assert.equal(node.planned_start, "2026-10-11");
  const assignment = db.prepare("SELECT * FROM schedule_assignments WHERE process_node_id = 1").get();
  assert.equal(assignment.status, "assigned");
  assert.equal(assignment.user_id, 5);
  assert.equal(assignment.estimated_hours, 6);

  // 2) 产能: capacity_per_day=1 → 8 小时, 已派 6 小时
  const capacity = await callRoute(app, "GET", "/api/schedule/capacity", {
    query: { workstation_id: "9", date: "2026-10-11" },
  });
  assert.equal(capacity.res.body.capacity_hours, 8);
  assert.equal(capacity.res.body.assigned_hours, 6);
  assert.equal(capacity.res.body.available_hours, 2);
  assert.equal(capacity.res.body.can_accept, true);

  // 3) 我的任务: 只返回一条, 不重复
  const tasks = await callRoute(app, "GET", "/api/schedule/my-tasks", { user: { sub: 5 } });
  assert.equal(tasks.res.body.tasks.length, 1);
  assert.equal(tasks.res.body.tasks[0].id, 1);
  assert.equal(tasks.res.body.tasks[0].instance_code, "TBM-1");

  // 4) 状态流转到 completed
  const completed = await callRoute(app, "PUT", "/api/schedule/process-nodes/:id/status", {
    params: { id: "1" },
    body: { status: "completed" },
  });
  assert.equal(completed.res.body.status, "completed");
  const after = db.prepare("SELECT * FROM process_nodes WHERE id = 1").get();
  assert.equal(after.status, "completed");
  assert.ok(after.actual_start && after.actual_end, "completed 应回填 actual_start/actual_end");
  assert.equal(db.prepare("SELECT status FROM schedule_assignments WHERE process_node_id = 1").get().status, "completed");

  // 5) 非法状态被拒
  const bad = await callRoute(app, "PUT", "/api/schedule/process-nodes/:id/status", {
    params: { id: "1" },
    body: { status: "nonsense" },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.err.status, 400);
  db.close();
});
