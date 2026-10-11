"use strict";
// services/supplierCollaboration/ 拆分的回归守卫 (2026-10-11)
//
// 依据: aiModelTraining 拆分时暴露的两类真实缺陷 ——
//   1) 新目录深一层, 相对 require 全部失效;
//   2) P1-4 曾在原文件里声明 ALLOWED_TABLES 却没接进 addColumn(假修复)。
// 这两条都在这里守住。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "supplierCollaboration");
const supplierCollaboration = require("../services/supplierCollaboration");

// 拆分前 services/supplierCollaborationService.js 里注册的 8 条路由
const EXPECTED_ROUTES = [
  ["GET", "/api/supplier-collab/pending-receipts"],
  ["GET", "/api/supplier-collab/incoming-inspections"],
  ["POST", "/api/supplier-collab/incoming-inspections"],
  ["GET", "/api/supplier-collab/outsourcing-orders"],
  ["POST", "/api/supplier-collab/outsourcing-orders"],
  ["PUT", "/api/supplier-collab/outsourcing-orders/:id"],
  ["GET", "/api/supplier-collab/scorecards"],
  ["GET", "/api/supplier-collab/overview"],
];

test("SPLIT.1 公共面与原 supplierCollaborationService 保持一致", () => {
  for (const name of [
    "applyIncomingInspectionResult",
    "ensureSchema",
    "findReceiving",
    "getReceivingContext",
    "register",
  ]) {
    assert.equal(typeof supplierCollaboration[name], "function", `missing export: ${name}`);
  }
});

test("SPLIT.2 拆分目录里每个相对 require 都能解析", () => {
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

test("SPLIT.3 ALLOWED_TABLES 覆盖所有 addColumn 调用点，且真的会拒绝未知表", () => {
  const schema = fs.readFileSync(path.join(MODULE_DIR, "schema.js"), "utf8");
  const called = [...schema.matchAll(/addColumn\(db,\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(called.length >= 4, `addColumn 调用点应有 4 处，实际 ${called.length}`);
  for (const table of called) {
    assert.ok(supplierCollaboration.ALLOWED_TABLES.has(table), `${table} 不在 ALLOWED_TABLES 里`);
  }
  // 守卫必须真的生效: P1-4 在原文件里只声明了 Set，没有接进 addColumn
  const db = new Database(":memory:");
  db.exec("CREATE TABLE not_whitelisted (id INTEGER PRIMARY KEY)");
  assert.throws(
    () => supplierCollaboration.addColumn(db, "not_whitelisted", "x", "x INTEGER"),
    /Invalid table name/
  );
  db.close();
});

test("SPLIT.4 register 装配的路由清单与拆分前逐条一致", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE purchase_receiving (id INTEGER PRIMARY KEY)");
  const routes = [];
  const app = {
    get: (routePath) => routes.push(["GET", routePath]),
    post: (routePath) => routes.push(["POST", routePath]),
    put: (routePath) => routes.push(["PUT", routePath]),
  };

  supplierCollaboration.register(app, db);
  const sortKey = (pair) => `${pair[0]} ${pair[1]}`;
  assert.deepEqual(routes.map(sortKey).sort(), EXPECTED_ROUTES.map(sortKey).sort());
  // ensureSchema 建出来的表也要在
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
  for (const table of ["incoming_inspections", "outsourcing_orders", "supplier_score_snapshots"]) {
    assert.ok(tables.includes(table), `缺少表 ${table}`);
  }
  assert.ok(
    db.prepare("PRAGMA table_info(incoming_inspections)").all().some((column) => column.name === "receiving_id"),
    "incoming_inspections.receiving_id 迁移未执行"
  );
  db.close();
});
