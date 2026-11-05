"use strict";
// tests/assignmentValidation.test.js
// 2026-11-05（审计 F-06）：派工资质校验抽公共模块 + /schedule 派工复用。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { validateAssignment } = require("../shared/assignmentValidation");
const registerRoutes1 = require("../services/schedule/routes/routes_1");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role_code TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, sequence INTEGER,
      status TEXT, phase_code TEXT, planned_start TEXT, planned_end TEXT, estimated_hours REAL,
      subsystem_id INTEGER, assigned_to INTEGER, required_workstation_id INTEGER,
      required_skill TEXT, required_position_code TEXT, operation_template_id INTEGER, updated_at TEXT
    );
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE worker_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, skill_category TEXT, skill_name TEXT, proficiency_level INTEGER
    );
    CREATE TABLE process_positions (
      position_code TEXT PRIMARY KEY, position_name TEXT, skill_category TEXT, min_level INTEGER, required_cert_type TEXT
    );
    CREATE TABLE process_operation_templates (
      id INTEGER PRIMARY KEY, sop_required INTEGER, drawing_required INTEGER
    );
    CREATE TABLE process_operation_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, operation_template_id INTEGER, doc_id INTEGER, doc_type TEXT, title TEXT, is_required INTEGER
    );
    CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE doc_acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER, ack_by INTEGER);
    CREATE TABLE schedule_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, process_node_id INTEGER, user_id INTEGER, workstation_id INTEGER,
      planned_start TEXT, planned_end TEXT, estimated_hours REAL, status TEXT, updated_at TEXT
    );

    INSERT INTO users (id, username, full_name, role_code, is_active) VALUES
      (5, 'w1', '王师傅', 'worker', 1),
      (6, 'w2', '无证学徒', 'worker', 1);
    INSERT INTO worker_skills (user_id, skill_category, proficiency_level) VALUES (5, 'cutting', 3);
    INSERT INTO workstations (id, name) VALUES (9, '下料工位');
    INSERT INTO process_nodes (id, equipment_instance_id, operation_name, sequence, status, required_skill) VALUES
      (1, 1, '下料', 1, 'pending', 'cutting'),
      (2, 1, '普通搬运', 2, 'pending', NULL);
  `);
  return db;
}

function makeApp() {
  const routes = new Map();
  return {
    routes,
    app: {
      get: (path, ...handlers) => routes.set("GET " + path, handlers),
      put: (path, ...handlers) => routes.set("PUT " + path, handlers),
    },
  };
}

function call(routes, method, path, { params = {}, body = {} } = {}) {
  const handlers = routes.get(`${method} ${path}`);
  assert.ok(handlers, `路由未注册: ${method} ${path}`);
  const handler = handlers[handlers.length - 1];
  let payload = null;
  let error = null;
  const res = {
    status(code) { return { json(value) { payload = { status: code, body: value }; } }; },
    json(value) { payload = { status: 200, body: value }; },
  };
  handler({ params, body, query: {}, user: { sub: 1 } }, res, (err) => { error = err; });
  return { payload, error };
}

test("AV.1 有资质：技能匹配 → ok", () => {
  const db = makeDb();
  const result = validateAssignment(db, { process_node_id: 1, user_id: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.required_skill, "cutting");
  assert.equal(result.matched_skill.proficiency_level, 3);
  db.close();
});

test("AV.2 无资质：缺技能 → missing 明确", () => {
  const db = makeDb();
  const result = validateAssignment(db, { process_node_id: 1, user_id: 6 });
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((item) => /缺少 cutting/.test(item)));
  db.close();
});

test("AV.3 无技能要求节点：任意在职人员可通过", () => {
  const db = makeDb();
  assert.equal(validateAssignment(db, { process_node_id: 2, user_id: 6 }).ok, true);
  db.close();
});

test("AV.4 人员不存在 / 停用 / 节点不存在 → 404", () => {
  const db = makeDb();
  assert.throws(() => validateAssignment(db, { process_node_id: 1, user_id: 999 }), (error) => error.status === 404);
  db.prepare("UPDATE users SET is_active = 0 WHERE id = 6").run();
  assert.throws(() => validateAssignment(db, { process_node_id: 1, user_id: 6 }), (error) => error.status === 404);
  assert.throws(() => validateAssignment(db, { process_node_id: 999, user_id: 5 }), (error) => error.status === 404);
  db.close();
});

test("AV.5 /schedule 派工：无资质被拒，force=true 放行", () => {
  const db = makeDb();
  const { app, routes } = makeApp();
  const ctx = {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
  registerRoutes1(app, db, ctx);

  const rejected = call(routes, "PUT", "/api/schedule/process-nodes/:id/assign", {
    params: { id: "1" },
    body: { user_id: 6, workstation_id: 9, planned_start: "2026-11-10", planned_end: "2026-11-10" },
  });
  assert.ok(rejected.error, "无资质应被拒");
  assert.equal(rejected.error.status, 400);
  assert.match(String(rejected.error.message), /资质/);

  const forced = call(routes, "PUT", "/api/schedule/process-nodes/:id/assign", {
    params: { id: "1" },
    body: { user_id: 6, workstation_id: 9, planned_start: "2026-11-10", planned_end: "2026-11-10", force: true },
  });
  assert.equal(forced.error, null);
  assert.equal(forced.payload.body.validation.ok, false, "force 时仍返回校验结果");
  assert.equal(db.prepare("SELECT assigned_to FROM process_nodes WHERE id = 1").get().assigned_to, 6);
  db.close();
});

test("AV.6 /schedule 派工：有资质正常通过并返回 validation", () => {
  const db = makeDb();
  const { app, routes } = makeApp();
  const ctx = {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
  registerRoutes1(app, db, ctx);
  const ok = call(routes, "PUT", "/api/schedule/process-nodes/:id/assign", {
    params: { id: "1" },
    body: { user_id: 5, workstation_id: 9, planned_start: "2026-11-10", planned_end: "2026-11-10" },
  });
  assert.equal(ok.error, null);
  assert.equal(ok.payload.body.ok, true);
  assert.equal(ok.payload.body.validation.ok, true);
  db.close();
});
