'use strict';
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const masterData = require("../services/masterDataService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, parent_id INTEGER, tier INTEGER, part_number TEXT, material_id INTEGER, quantity REAL, category TEXT, level_code TEXT, version TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT, doc_code TEXT, version TEXT);
    CREATE TABLE suppliers (id INTEGER PRIMARY KEY, supplier_code TEXT, supplier_name TEXT);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY, code TEXT, name TEXT, capacity_per_day REAL);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, operation_name TEXT, estimated_hours REAL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, role_code TEXT, cert_no TEXT);
    CREATE TABLE worker_certificates (id INTEGER PRIMARY KEY, user_id INTEGER, cert_type TEXT, cert_name TEXT, status TEXT, expiry_date TEXT);
    INSERT INTO materials (id, material_code, material_name) VALUES (1, 'MAT-001', '物料一'), (2, 'MAT-002', '重复名称'), (3, 'MAT-003', '重复名称');
    INSERT INTO instance_bom (id, parent_id, tier, part_number, material_id, quantity, category, level_code, version) VALUES
      (1, NULL, 0, 'P-1', 1, 1, '成品', 'L0', 'A'),
      (2, 1, 1, NULL, NULL, 1, '部件', 'L1', 'A'),
      (3, 1, 1, 'P-3', NULL, 1, '部件', 'L1', 'A'),
      (4, 1, 1, NULL, 999, 1, '部件', 'L1', 'A');
    INSERT INTO documents (id, title, doc_code, version) VALUES (1, '图纸一', 'D-1', 'A');
    INSERT INTO suppliers (id, supplier_code, supplier_name) VALUES (1, 'S-1', '供应商一');
    INSERT INTO workstations (id, code, name, capacity_per_day) VALUES (1, 'WS-1', '工位一', 8);
    INSERT INTO process_nodes (id, operation_name, estimated_hours) VALUES (1, '工序一', 2);
    INSERT INTO users (id, full_name, role_code, cert_no) VALUES
      (1, '无证焊工', 'welder', NULL),
      (2, '有证质检', 'qc', NULL),
      (3, '过期工人', 'worker', 'OLD-1');
    INSERT INTO worker_certificates (id, user_id, cert_type, cert_name, status, expiry_date) VALUES
      (1, 2, 'quality', '质检证', 'valid', '2099-01-01'),
      (2, 3, 'welding', '焊工证', 'expired', '2000-01-01');
  `);
  return db;
}
function makeApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  masterData.register(app, db);
  return { routes, find: (method, route) => routes.get(`${method.toUpperCase()} ${route}`) };
}
function invoke(handler, request = {}) {
  return new Promise((resolve, reject) => {
    const state = { status: 200, body: null };
    const res = { status(code) { state.status = code; return this; }, json(body) { state.body = body; return this; } };
    const req = { params: {}, query: {}, body: {}, user: { uid: 1, role: "admin", permissions: ["*"] }, ...request };
    const next = (error) => reject(error);
    try {
      const ret = handler(req, res, next);
      Promise.resolve(ret).then(() => resolve(state)).catch(reject);
    } catch (error) { reject(error); }
  });
}

test("MDM-1 BOM 物料关联/人员证书检查不再误报", async () => {
  const db = makeDb();
  const { find } = makeApp(db);
  const overview = await invoke(find("GET", "/api/mdm/overview"));
  assert.equal(overview.status, 200);
  const issues = overview.body.issues || [];
  const missingPart = issues.filter((item) => item.rule === "missing_part");
  assert.equal(missingPart.length, 1);
  assert.equal(missingPart[0].ref_id, "2");
  assert.equal(issues.filter((item) => item.rule === "orphan_material_ref").length, 1);
  assert.equal(issues.filter((item) => item.rule === "missing_certificate").length, 1);
  assert.equal(issues.filter((item) => item.rule === "expired_certificate").length, 1);
  assert.equal(issues.filter((item) => item.rule === "duplicate_name").length, 1);
  assert.equal(overview.body.summary.scan_errors.length, 0);
  db.close();
});

test("MDM-2 忽略/恢复/未知问题/审计语义", async () => {
  const db = makeDb();
  const { find } = makeApp(db);
  let overview = await invoke(find("GET", "/api/mdm/overview"));
  const target = overview.body.issues.find((item) => item.rule === "missing_part");
  const waived = await invoke(find("POST", "/api/mdm/issues/:id/waive"), { params: { id: target.id }, body: { reason: "测试忽略" } });
  assert.equal(waived.status, 200);
  overview = await invoke(find("GET", "/api/mdm/overview"));
  assert.equal(overview.body.issues.some((item) => item.id === target.id), false);
  const list = await invoke(find("GET", "/api/mdm/waivers"), { query: { active: 1 } });
  assert.equal(list.body.waivers.length, 1);
  const reopened = await invoke(find("POST", "/api/mdm/issues/:id/reopen"), { params: { id: target.id } });
  assert.equal(reopened.status, 200);
  overview = await invoke(find("GET", "/api/mdm/overview"));
  assert.equal(overview.body.issues.some((item) => item.id === target.id), true);
  await assert.rejects(
    () => invoke(find("POST", "/api/mdm/issues/:id/waive"), { params: { id: "not_exists" }, body: { reason: "x" } }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/mdm/issues/:id/reopen"), { params: { id: target.id } }),
    (error) => error.status === 404,
  );
  db.close();
});

test("MDM-3 issues 分页参数健壮性/overview 可裁剪 issues", async () => {
  const db = makeDb();
  const { find } = makeApp(db);
  const badLimit = await invoke(find("GET", "/api/mdm/issues"), { query: { limit: "abc" } });
  assert.ok(badLimit.body.issues.length > 0);
  assert.equal(badLimit.body.truncated, false);
  const limited = await invoke(find("GET", "/api/mdm/issues"), { query: { domain: "bom", limit: "1" } });
  assert.equal(limited.body.issues.length, 1);
  assert.ok(limited.body.total > 1);
  assert.equal(limited.body.truncated, true);
  assert.equal(limited.body.summary.domains, 6);
  const overview = await invoke(find("GET", "/api/mdm/overview"), { query: { include_issues: "0" } });
  assert.deepEqual(overview.body.issues, []);
  assert.ok(overview.body.domains.length === 6);
  db.close();
});
