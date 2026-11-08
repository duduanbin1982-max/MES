'use strict';
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const codingRules = require("../services/codingRulesService");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT UNIQUE);
    CREATE TABLE equipment_instance_templates (id INTEGER PRIMARY KEY, template_code TEXT UNIQUE);
  `);
  return db;
}
function makeApp(db) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "delete"]) app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  codingRules.register(app, db);
  return { routes, find: (method, route) => routes.get(`${method} ${route}`) };
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

test("CODE-1 默认规则/预览不消耗序列/客户映射/年度重置", async () => {
  const db = makeDb();
  const { find } = makeApp(db);
  const list = await invoke(find("GET", "/api/coding-rules"));
  assert.ok(list.body.rules.length >= 2);
  const updated = await invoke(find("PUT", "/api/coding-rules/:ruleCode"), {
    params: { ruleCode: "equipment_instance" },
    body: { customer_map_json: { "郑州地铁集团": "ZZDT" } },
  });
  assert.equal(updated.status, 200);

  const preview1 = await invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "equipment_instance" }, query: { customer: "郑州地铁集团", year: "2026" } });
  assert.equal(preview1.body.code, "TBM-ZZDT-2026-001");
  const preview2 = await invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "equipment_instance" }, query: { customer: "郑州地铁集团", year: "2026" } });
  assert.equal(preview2.body.code, "TBM-ZZDT-2026-001");

  const allocator = codingRules.createCodeAllocator(db);
  const actual = allocator.nextCode("equipment_instance", { customer: "郑州地铁集团", year: 2026 });
  assert.equal(actual.code, "TBM-ZZDT-2026-001");
  const preview3 = await invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "equipment_instance" }, query: { customer: "郑州地铁集团", year: "2026" } });
  assert.equal(preview3.body.code, "TBM-ZZDT-2026-002");
  const nextYear = await invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "equipment_instance" }, query: { customer: "郑州地铁集团", year: "2027" } });
  assert.equal(nextYear.body.code, "TBM-ZZDT-2027-001");
  db.close();
});

test("CODE-2 规则 CRUD 校验/重复/停用预览", async () => {
  const db = makeDb();
  const { find } = makeApp(db);
  await assert.rejects(
    () => invoke(find("POST", "/api/coding-rules"), { body: { rule_code: "Bad Code!", name: "x" } }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => invoke(find("POST", "/api/coding-rules"), { body: { rule_code: "equipment_instance", name: "重复" } }),
    (error) => error.status === 409,
  );
  const created = await invoke(find("POST", "/api/coding-rules"), {
    body: { rule_code: "material_code", name: "物料编码", entity_type: "generic", prefix: "MAT", year_mode: "none", sequence_width: 4, reset_policy: "never" },
  });
  assert.equal(created.status, 201);
  await assert.rejects(
    () => invoke(find("POST", "/api/coding-rules"), { body: { rule_code: "bad_width", name: "x", sequence_width: 9 } }),
    (error) => error.status === 400,
  );
  const preview = await invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "material_code" }, query: { year: "2026" } });
  assert.equal(preview.body.code, "MAT-0001");
  await invoke(find("PUT", "/api/coding-rules/:ruleCode"), { params: { ruleCode: "material_code" }, body: { is_active: false } });
  await assert.rejects(
    () => invoke(find("GET", "/api/coding-rules/:ruleCode/preview"), { params: { ruleCode: "material_code" }, query: { year: "2026" } }),
    (error) => error.status === 404,
  );
  db.close();
});
