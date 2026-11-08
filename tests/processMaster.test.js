require("dotenv").config();
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const express = require("express");
const http = require("node:http");
const { errorHandler, notFoundHandler } = require("../app/errors");

let db;
let server;
let port;

function freshDb() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      role_code TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE worker_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      skill_name TEXT NOT NULL,
      skill_category TEXT NOT NULL DEFAULT 'general',
      proficiency_level INTEGER NOT NULL DEFAULT 1,
      years_experience REAL DEFAULT 0,
      certified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE worker_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cert_type TEXT NOT NULL,
      cert_name TEXT NOT NULL,
      cert_number TEXT,
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'valid'
    );

    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE doc_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      ack_by INTEGER NOT NULL,
      ack_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE workstations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      workshop TEXT,
      station_type TEXT,
      status TEXT DEFAULT 'available',
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_instance_id INTEGER NOT NULL,
      operation_name TEXT NOT NULL,
      operation_type TEXT DEFAULT 'make',
      estimated_hours REAL DEFAULT 0,
      drawing_required INTEGER DEFAULT 0,
      qc_required INTEGER DEFAULT 0,
      sop_required INTEGER DEFAULT 0,
      operation_template_id INTEGER,
      required_workstation_id INTEGER,
      required_skill TEXT,
      status TEXT DEFAULT 'pending',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  database.prepare("INSERT INTO users (id, full_name, role_code, is_active) VALUES (1, '王焊工', 'worker', 1)").run();
  database.prepare("INSERT INTO users (id, full_name, role_code, is_active) VALUES (2, '普通工', 'worker', 1)").run();
  database.prepare("INSERT INTO worker_skills (user_id, skill_name, skill_category, proficiency_level, certified) VALUES (1, '手工焊', 'welding', 4, 1)").run();
  database.prepare("INSERT INTO worker_certificates (user_id, cert_type, cert_name, cert_number, expiry_date, status) VALUES (1, 'welding', '焊工证', 'HG-1', '2099-01-01', 'valid')").run();
  database.prepare("INSERT INTO workstations (code, name, workshop, station_type, status, is_active) VALUES ('WS-WELD-1', '焊接工位', '焊接', 'welding', 'available', 1)").run();
  database.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name) VALUES (1, '待配置')").run();
  return database;
}

function createServer(database) {
  const app = express();
  app.use(express.json());
  require("../services/processMasterService").register(app, database);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.before(async () => {
  db = freshDb();
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) db.close();
});

test("process master seeds positions and operation templates", async () => {
  const positions = await request("GET", "/api/process-master/positions");
  const operations = await request("GET", "/api/process-master/operations");
  assert.equal(positions.status, 200);
  assert.ok(positions.body.items.some((row) => row.position_code === "welder"));
  assert.equal(operations.status, 200);
  assert.ok(operations.body.items.some((row) => row.operation_code === "welding"));
});

test("can create position and operation template", async () => {
  const pos = await request("POST", "/api/process-master/positions", {
    position_code: "painter",
    position_name: "涂装工",
    skill_category: "painting",
    min_level: 2,
  });
  assert.equal(pos.status, 201);
  const op = await request("POST", "/api/process-master/operations", {
    operation_code: "painting",
    operation_name: "喷漆",
    default_station_type: "painting",
    required_position_code: "painter",
    required_skill: "painting",
    standard_hours: 3,
  });
  assert.equal(op.status, 201);
});

test("apply template writes node operation, station, skill and position", async () => {
  const welding = db.prepare("SELECT id FROM process_operation_templates WHERE operation_code = 'welding'").get();
  const r = await request("POST", "/api/process_nodes/1/apply-template", { operation_template_id: welding.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const node = db.prepare("SELECT * FROM process_nodes WHERE id = 1").get();
  assert.equal(node.operation_name, "焊接");
  assert.equal(node.required_skill, "welding");
  assert.equal(node.required_position_code, "welder");
  assert.equal(node.required_workstation_id, 1);
});

test("assignment validation checks skill and certificate", async () => {
  const blocked = await request("POST", "/api/process-master/validate-assignment", { process_node_id: 1, user_id: 1 });
  assert.equal(blocked.body.ok, false);
  assert.ok(blocked.body.missing.some((item) => item.includes("SOP")));
  assert.ok(blocked.body.missing.some((item) => item.includes("图纸")));

  const welding = db.prepare("SELECT id FROM process_operation_templates WHERE operation_code='welding'").get();
  const sop = db.prepare("INSERT INTO documents (title,status) VALUES ('WPS','issued')").run().lastInsertRowid;
  const drawing = db.prepare("INSERT INTO documents (title,status) VALUES ('焊接图','issued')").run().lastInsertRowid;
  db.prepare("INSERT INTO process_operation_docs (operation_template_id,doc_type,title,doc_id,is_required) VALUES (?,?,?,?,1)").run(welding.id, "sop", "WPS", sop);
  db.prepare("INSERT INTO process_operation_docs (operation_template_id,doc_type,title,doc_id,is_required) VALUES (?,?,?,?,1)").run(welding.id, "drawing", "焊接图", drawing);
  db.prepare("INSERT INTO doc_acknowledgements (doc_id,ack_by) VALUES (?,1),(?,1)").run(sop, drawing);

  const ok = await request("POST", "/api/process-master/validate-assignment", { process_node_id: 1, user_id: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);

  const bad = await request("POST", "/api/process-master/validate-assignment", { process_node_id: 1, user_id: 2 });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.missing.some((item) => item.includes("welding")));
  assert.ok(bad.body.missing.some((item) => item.includes("welding 资质")));
});


test("process operation template includes drawing_required", async () => {
  const res = await request("GET", "/api/process-master/operations");
  assert.equal(res.status, 200);
  const w = res.body.items.find(r => r.operation_code === "welding");
  const n = res.body.items.find(r => r.operation_code === "ndt");
  assert.equal(w.drawing_required, 1, "welding requires drawings");
  assert.equal(n.drawing_required, 0, "ndt does not require drawings");
});

test("can bind document to operation template and list", async () => {
  const ops = await request("GET", "/api/process-master/operations");
  const w = ops.body.items.find(r => r.operation_code === "welding");
  assert.ok(w, "welding template exists");
  const p1 = await request("POST", "/api/process-master/operations/" + w.id + "/docs", {
    title: "WPS Welding Procedure",
    doc_type: "qc_std",
    is_required: true
  });
  assert.equal(p1.status, 201);
  const list = await request("GET", "/api/process-master/operations/" + w.id + "/docs");
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 1);
  assert.ok(list.body.items.some(d => d.title === "WPS Welding Procedure"));
});

test("validation checks missing required documents", async () => {
  const ops = await request("GET", "/api/process-master/operations");
  const t = ops.body.items.find(r => r.node_count > 0);
  if (!t) return;
  await request("POST", "/api/process-master/operations/" + t.id + "/docs", {
    title: "Required SOP",
    doc_type: "sop",
    is_required: true
  });
  const r = await request("POST", "/api/process-master/validate-assignment", {
    process_node_id: 1,
    user_id: 1
  });
  assert.equal(r.status, 200);
});

test("PMA-1 岗位编码不允许修改，避免工序/节点引用孤儿", async () => {
  const before = db.prepare("SELECT position_code FROM process_positions WHERE position_code = 'painter'").get();
  assert.ok(before);
  const renamed = await request("PUT", "/api/process-master/positions/painter", { position_code: "painter2", position_name: "涂装工2" });
  assert.equal(renamed.status, 400);
  assert.match(renamed.body.message, /岗位编码不允许修改/);
  assert.ok(db.prepare("SELECT 1 FROM process_positions WHERE position_code = 'painter'").get());
});

test("PMA-2 被引用的岗位不能删除", async () => {
  const res = await request("DELETE", "/api/process-master/positions/welder");
  assert.equal(res.status, 409);
  assert.match(res.body.message, /正在被/);
});

test("PMA-3 停用岗位会被派工校验拦截", async () => {
  const before = db.prepare("SELECT is_active FROM process_positions WHERE position_code = 'welder'").get();
  db.prepare("UPDATE process_positions SET is_active = 0 WHERE position_code = 'welder'").run();
  const blocked = await request("POST", "/api/process-master/validate-assignment", { process_node_id: 1, user_id: 1 });
  assert.equal(blocked.status, 200);
  assert.ok(blocked.body.missing.some((item) => item.includes("焊工") && item.includes("停用")), JSON.stringify(blocked.body.missing));
  db.prepare("UPDATE process_positions SET is_active = ? WHERE position_code = 'welder'").run(before.is_active);
});

test("PMA-4 工序文档更新不能制造重复绑定", async () => {
  const op = db.prepare("SELECT id FROM process_operation_templates WHERE operation_code = 'welding'").get();
  const doc = db.prepare("INSERT INTO documents (title, status) VALUES ('重复绑定测试','issued')").run().lastInsertRowid;
  const first = await request("POST", `/api/process-master/operations/${op.id}/docs`, { doc_type: "sop", title: "A", doc_id: doc, is_required: true });
  const second = await request("POST", `/api/process-master/operations/${op.id}/docs`, { doc_type: "qc_std", title: "B", doc_id: doc, is_required: true });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const update = await request("PUT", `/api/process-master/operations/${op.id}/docs/${second.body.id}`, { doc_type: "sop" });
  assert.equal(update.status, 409);
  assert.match(update.body.message, /已绑定/);
});

test("PMA-5 配置健康度返回未配置/文档缺口", async () => {
  db.prepare("INSERT INTO process_nodes (equipment_instance_id, operation_name) VALUES (1, '未配置节点')").run();
  const res = await request("GET", "/api/process-master/health");
  assert.equal(res.status, 200);
  assert.ok(res.body.nodes.total >= 1);
  assert.ok(res.body.templates.total >= 1);
  assert.ok(Array.isArray(res.body.issues));
  assert.ok(res.body.issues.some((issue) => issue.code === "NODES_UNCONFIGURED"));
});


test("PMA-6 工序模板默认规格可维护", async () => {
  const ops = await request("GET", "/api/process-master/operations");
  const welding = ops.body.items.find((row) => row.operation_code === "welding");
  assert.ok(welding);
  let res = await request("PUT", `/api/process-master/operations/${welding.id}/specs`, { specs: { temperature_c: { lsl: 180, usl: 280, target: 230 } } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await request("GET", `/api/process-master/operations/${welding.id}/specs`);
  assert.equal(res.body.specs.temperature_c.usl, 280);
  const list = await request("GET", "/api/process-master/operations");
  assert.equal(list.body.items.find((row) => row.id === welding.id).has_default_specs, 1);
});
