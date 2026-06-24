"use strict";
// tests/materialPrices.test.js
// 普通物料价格 CRUD + 批量录入
//
// 测什么:
//   1) GET /api/materials/:id 返回详情 + used_in
//   2) PUT 改价 - admin 成功
//   3) PUT 改价 - 负数 -> 400
//   4) PUT 改价 - 字段全空 -> 400
//   5) 批量录入 - 全部成功
//   6) 批量录入 - 部分失败 (id 不存在) -> 错误分桶
//   7) 覆盖率 summary - 反映录入前后
//   8) cost_rollup 拿到真实价格 (验证与 costRollup 服务的集成)

const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

let passed = 0, failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { console.log("  OK " + label); passed++; }
  else { console.log("  FAIL " + label + "\n     got:  " + JSON.stringify(got) + "\n     want: " + JSON.stringify(want)); failed++; }
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec([
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);",
    "CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT);",
    // materials 含 estimated/actual_unit_price
    "CREATE TABLE materials (",
    "  id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, unit TEXT,",
    "  estimated_unit_price REAL NOT NULL DEFAULT 0,",
    "  actual_unit_price    REAL NOT NULL DEFAULT 0,",
    "  created_at TEXT NOT NULL DEFAULT '2026-06-01', updated_at TEXT NOT NULL DEFAULT '2026-06-01'",
    ");",
    "CREATE TABLE instance_bom (",
    "  id INTEGER PRIMARY KEY,",
    "  equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER",
    ");",
    "INSERT INTO users VALUES (1, 'admin');",
    "INSERT INTO equipment_instances VALUES (1, 'TBM-001', '测试盾构机');",
    "INSERT INTO materials VALUES (10, 'M-ST-Q345', '钢板', 'raw', 'kg', 0, 0, '2026-06-01', '2026-06-01');",
    "INSERT INTO materials VALUES (11, 'M-BOLT', '螺栓', 'std', 'pcs', 0, 0, '2026-06-01', '2026-06-01');",
    "INSERT INTO materials VALUES (12, 'M-CABLE', '电缆', 'std', 'm', 0, 0, '2026-06-01', '2026-06-01');",
    "INSERT INTO instance_bom VALUES (1, 1, 10, 100, 0);",
    "INSERT INTO instance_bom VALUES (2, 1, 11, 50,  0);",
  ].join("\n"));
  return db;
}

function makeReqRes(reqOpts) {
  const o = reqOpts || {};
  const req = { body: o.body || {}, params: o.params || {}, query: o.query || {}, user: o.user || { uid: 1, role: "admin" } };
  let statusCode = 200, jsonBody = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; }
  };
  return { req, res, getResult: function () { return { statusCode, body: jsonBody }; } };
}

const fakeApp = {
  _routes: {},
  get:    function (p) { const hs = Array.prototype.slice.call(arguments, 1); this._store("GET",    p, hs); },
  post:   function (p) { const hs = Array.prototype.slice.call(arguments, 1); this._store("POST",   p, hs); },
  put:    function (p) { const hs = Array.prototype.slice.call(arguments, 1); this._store("PUT",    p, hs); },
  delete: function (p) { const hs = Array.prototype.slice.call(arguments, 1); this._store("DELETE", p, hs); },
  _store: function (m, p, hs) { const k = m + " " + p; if (!this._routes[k]) this._routes[k] = []; for (const h of hs) this._routes[k].push(h); }
};
function dispatch(method, p, req, res) {
  const chain = fakeApp._routes[method + " " + p];
  if (!chain) throw new Error("no route " + method + " " + p);
  for (const h of chain) {
    if (h.length === 3) { h(req, res, function () {}); continue; }
    h(req, res);
  }
}

console.log("=== materialPrices ===");
{
  const db = makeDb();
  // stub auth: requireRole 永远 next
delete require.cache[require.resolve("../middleware/auth")];
require.cache[require.resolve("../middleware/auth")] = {
  exports: { requireRole: function () { return function (req, res, next) { if (typeof next === "function") next(); }; } }
};

delete require.cache[require.resolve("../services/cost/materialPrices")];
  const { register } = require("../services/cost/materialPrices");
  register(fakeApp, db);

  // 1) GET material detail + used_in
  {
    const r = makeReqRes({ params: { id: "10" } });
    dispatch("GET", "/api/materials/:id", r.req, r.res);
    const j = r.getResult();
    eq("1. status 200", j.statusCode, 200);
    eq("1. material.id", j.body.material.id, 10);
    eq("1. used_in count = 1", j.body.used_in.length, 1);
    eq("1. used_in[0].instance_code", j.body.used_in[0].instance_code, "TBM-001");
  }
  // 1b) GET 不存在
  {
    const r = makeReqRes({ params: { id: "999" } });
    dispatch("GET", "/api/materials/:id", r.req, r.res);
    eq("1b. status 404", r.getResult().statusCode, 404);
  }

  // 2) PUT 改价
  {
    const r = makeReqRes({ body: { estimated_unit_price: 8.5, actual_unit_price: 9.2 }, params: { id: "10" } });
    dispatch("PUT", "/api/materials/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("2. status 200", j.statusCode, 200);
    eq("2. estimated = 8.5", j.body.material.estimated_unit_price, 8.5);
    eq("2. actual = 9.2", j.body.material.actual_unit_price, 9.2);
    const row = db.prepare("SELECT estimated_unit_price, actual_unit_price FROM materials WHERE id=10").get();
    eq("2. db estimated = 8.5", row.estimated_unit_price, 8.5);
    eq("2. db actual = 9.2", row.actual_unit_price, 9.2);
  }

  // 3) PUT 负数 -> 400
  {
    const r = makeReqRes({ body: { estimated_unit_price: -1 }, params: { id: "10" } });
    dispatch("PUT", "/api/materials/:id/prices", r.req, r.res);
    eq("3. status 400 (负数)", r.getResult().statusCode, 400);
  }

  // 4) PUT 全空 -> 400
  {
    const r = makeReqRes({ body: {}, params: { id: "10" } });
    dispatch("PUT", "/api/materials/:id/prices", r.req, r.res);
    eq("4. status 400 (无字段)", r.getResult().statusCode, 400);
  }

  // 4b) 只给 estimated
  {
    const r = makeReqRes({ body: { estimated_unit_price: 7.5 }, params: { id: "11" } });
    dispatch("PUT", "/api/materials/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("4b. status 200", j.statusCode, 200);
    eq("4b. estimated = 7.5", j.body.material.estimated_unit_price, 7.5);
    // actual 保持 0 (没传)
    eq("4b. actual 仍 0", j.body.material.actual_unit_price, 0);
  }

  // 5) 批量录入 - 全成功
  {
    const r = makeReqRes({ body: { items: [
      { material_id: 10, actual_unit_price: 9.5 },
      { material_id: 11, estimated_unit_price: 1.2, actual_unit_price: 1.5 },
      { material_id: 12, estimated_unit_price: 25,  actual_unit_price: 28 }
    ] } });
    dispatch("POST", "/api/materials/prices/bulk", r.req, r.res);
    const j = r.getResult();
    eq("5. status 200", j.statusCode, 200);
    eq("5. updated = 3", j.body.updated, 3);
    eq("5. skipped = 0", j.body.skipped, 0);
    const m10 = db.prepare("SELECT estimated_unit_price, actual_unit_price FROM materials WHERE id=10").get();
    eq("5. m10 estimated 保留 8.5 (COALESCE)", m10.estimated_unit_price, 8.5);
    eq("5. m10 actual 改 9.5", m10.actual_unit_price, 9.5);
  }

  // 6) 批量 - 部分失败
  {
    const r = makeReqRes({ body: { items: [
      { material_id: 10, estimated_unit_price: 8.0 },
      { material_id: 999, estimated_unit_price: 5 },
      { material_id: 11, estimated_unit_price: -1 },
      { material_id: 12 }
    ] } });
    dispatch("POST", "/api/materials/prices/bulk", r.req, r.res);
    const j = r.getResult();
    eq("6. status 200", j.statusCode, 200);
    eq("6. updated = 1 (only 10)", j.body.updated, 1);
    eq("6. skipped = 3", j.body.skipped, 3);
    eq("6. errors[0].material_id = 999", j.body.errors[0].material_id, 999);
    eq("6. errors[1].material_id = 11", j.body.errors[1].material_id, 11);
  }

  // 7) summary
  {
    const r = makeReqRes({});
    dispatch("GET", "/api/materials/prices/summary", r.req, r.res);
    const j = r.getResult();
    eq("7. status 200", j.statusCode, 200);
    eq("7. materials_total = 3", j.body.materials_total, 3);
    // m10 est 8.0 (from case 6 bulk), m11 est 1.2 (case 5), m12 est 25 -> 3 都 > 0
    eq("7. estimated_filled = 3", j.body.estimated_filled, 3);
    eq("7. estimated_coverage_pct = 100", j.body.estimated_coverage_pct, 100);
    // m10 act 9.5, m11 act 1.5, m12 act 28 -> 3
    eq("7. actual_filled = 3", j.body.actual_filled, 3);
    // 2 个物料在 BOM (m10, m11), 都已填 estimated -> 100%
    eq("7. used_in_bom_count = 2", j.body.used_in_bom_count, 2);
    eq("7. used_in_bom_coverage_pct = 100", j.body.used_in_bom_coverage_pct, 100);
  }

  // 8) 与 costRollup 集成 - 验证材料价格能进入 rollup
  // 这里直接模拟: 用 costRollup 同样的 SQL 算合计
  const rollup = db.prepare(`
    SELECT m.id, m.material_code, m.estimated_unit_price,
           COALESCE(SUM(ib.quantity), 0) AS qty,
           ROUND(m.estimated_unit_price * COALESCE(SUM(ib.quantity), 0), 2) AS est_total
      FROM instance_bom ib JOIN materials m ON m.id = ib.material_id
     WHERE ib.equipment_instance_id = 1 AND COALESCE(ib.is_key_component, 0) = 0
     GROUP BY m.id
  `).all();
  const tot = rollup.reduce((s, r) => s + Number(r.est_total), 0);
  eq("8. instance 1 普通物料总估价 = 8.0*100 + 1.2*50 = 860", Math.round(tot * 100) / 100, 860);
}

console.log("---");
console.log("passed:", passed, "failed:", failed);
process.exit(failed === 0 ? 0 : 1);
