"use strict";
// tests/keyComponentPrices.test.js
// 关键件合同价单测 (跑 npm test)
//
// 测什么:
//   1) 新建合同价 -> 当 last_price_id 被指向
//   2) 再建一条 -> 旧那条 valid_to 自动 = 新条 valid_from
//   3) 软删 -> last_price_id 回退到最新一条 still-active
//   4) GET /:id/prices/current 返回当前价 + 差价
//   5) 校验: actual_price 缺失 / 负数 -> 400
//
// 怎么跑:
//   node tests/keyComponentPrices.test.js
//
// 用 better-sqlite3 :memory: + 必要的 schema (不连真实 DB)

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
    "CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);",
    "CREATE TABLE key_components (",
    "  id INTEGER PRIMARY KEY,",
    "  material_id INTEGER REFERENCES materials(id),",
    "  component_type TEXT, supplier TEXT, supplier_part_no TEXT,",
    "  lead_time_weeks INTEGER, unit_price REAL, risk_level TEXT, notes TEXT,",
    "  last_price_id INTEGER",
    ");",
    "CREATE TABLE key_component_prices (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  key_component_id INTEGER NOT NULL REFERENCES key_components(id) ON DELETE CASCADE,",
    "  actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT,",
    "  currency TEXT NOT NULL DEFAULT 'CNY',",
    "  valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT,",
    "  priced_by INTEGER REFERENCES users(id),",
    "  priced_at TEXT NOT NULL",
    ");",
    "CREATE TRIGGER trg_kcp_close_previous",
    "AFTER INSERT ON key_component_prices",
    "FOR EACH ROW",
    "WHEN NEW.valid_to IS NULL",
    "BEGIN",
    "  UPDATE key_component_prices SET valid_to = NEW.valid_from",
    "   WHERE key_component_id = NEW.key_component_id AND id != NEW.id AND valid_to IS NULL;",
    "  UPDATE key_components SET last_price_id = NEW.id WHERE id = NEW.key_component_id;",
    "END;",
    "INSERT INTO users VALUES (1, 'admin');",
    "INSERT INTO materials VALUES (10, 'MAT-001', '主轴承');",
    "INSERT INTO key_components VALUES (4, 10, 'main_bearing', 'SKF', 'M-BRG-MAIN', 20, 380, 'high', NULL, NULL);"
  ].join("\n"));
  return db;
}

function makeReqRes(reqOpts) {
  const o = reqOpts || {};
  const req = { body: o.body || {}, params: o.params || {}, user: o.user || { uid: 1, role: "admin" } };
  let statusCode = 200, jsonBody = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; }
  };
  return { req, res, getResult: function () { return { statusCode, body: jsonBody }; } };
}

// stub auth: requireRole 永远 next
delete require.cache[require.resolve("../middleware/auth")];
require.cache[require.resolve("../middleware/auth")] = {
  exports: { requireRole: function () { return function (req, res, next) { if (typeof next === "function") next(); }; } }
};

delete require.cache[require.resolve("../services/cost/keyComponentPrices")];
const { register } = require("../services/cost/keyComponentPrices");

// mini express-like app: 支持多 handler 链
const routes = {};
function add(method, p) {
  const handlers = Array.prototype.slice.call(arguments, 2);
  const key = method + " " + p;
  if (!routes[key]) routes[key] = [];
  for (const h of handlers) routes[key].push(h);
}
const fakeApp = {
  _routes: routes,
  get:    function (p) { const hs = Array.prototype.slice.call(arguments, 1); add("GET",    p, ...hs); },
  post:   function (p) { const hs = Array.prototype.slice.call(arguments, 1); add("POST",   p, ...hs); },
  put:    function (p) { const hs = Array.prototype.slice.call(arguments, 1); add("PUT",    p, ...hs); },
  delete: function (p) { const hs = Array.prototype.slice.call(arguments, 1); add("DELETE", p, ...hs); }
};
function dispatch(method, p, req, res) {
  const chain = routes[method + " " + p];
  if (!chain) throw new Error("no route " + method + " " + p);
  for (const h of chain) {
    if (h.length === 3) { h(req, res, function () {}); continue; }
    h(req, res);
  }
}

console.log("=== keyComponentPrices ===");
{
  const db = makeDb();
  register(fakeApp, db);

  // 1) POST 新建合同价 360
  {
    const r = makeReqRes({ body: { actual_price: 360, contract_no: "CN-2026-001", valid_from: "2026-06-01" }, params: { id: "4" } });
    dispatch("POST", "/api/key_components/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("1. POST status 200", j.statusCode, 200);
    eq("1. actual_price", j.body.price.actual_price, 360);
    eq("1. ok=true", j.body.ok, true);
    const kc = db.prepare("SELECT last_price_id, unit_price FROM key_components WHERE id=4").get();
    eq("1. kc.last_price_id set", kc.last_price_id, j.body.price.id);
    eq("1. kc.unit_price untouched", kc.unit_price, 380);
  }

  // 2) 再建一条 395 -> 旧那条 valid_to 自动 = 2026-06-15
  {
    const r = makeReqRes({ body: { actual_price: 395, contract_no: "CN-2026-002", valid_from: "2026-06-15" }, params: { id: "4" } });
    dispatch("POST", "/api/key_components/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("2. POST status 200", j.statusCode, 200);
    const newId = j.body.price.id;
    const old = db.prepare("SELECT valid_to FROM key_component_prices WHERE id=1").get();
    eq("2. old.valid_to set", old.valid_to, "2026-06-15");
    const kc = db.prepare("SELECT last_price_id FROM key_components WHERE id=4").get();
    eq("2. last_price_id -> new", kc.last_price_id, newId);
  }

  // 3) GET /:id/prices 列出全部
  {
    const r = makeReqRes({ params: { id: "4" } });
    dispatch("GET", "/api/key_components/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("3. count = 2", j.body.count, 2);
    eq("3. items[0].actual_price = 395 (newest first)", j.body.items[0].actual_price, 395);
    eq("3. items[1].actual_price = 360", j.body.items[1].actual_price, 360);
    eq("3. items[1].valid_to = 2026-06-15", j.body.items[1].valid_to, "2026-06-15");
  }

  // 4) DELETE 软删当前生效的 395 -> last_price_id 回退到 360
  {
    const priceId = db.prepare("SELECT id FROM key_component_prices WHERE valid_to IS NULL ORDER BY id DESC LIMIT 1").get().id;
    const r = makeReqRes({ params: { priceId: String(priceId) } });
    dispatch("DELETE", "/api/key_components/prices/:priceId", r.req, r.res);
    const j = r.getResult();
    eq("4. DELETE ok", j.body.ok, true);
    const kc = db.prepare("SELECT last_price_id FROM key_components WHERE id=4").get();
    eq("4. last_price_id falls back to 360's row (id=1)", kc.last_price_id, 1);
  }

  // 5) GET /:id/prices/current 返回 360 + 差价 -20
  {
    const r = makeReqRes({ params: { id: "4" } });
    dispatch("GET", "/api/key_components/:id/prices/current", r.req, r.res);
    const j = r.getResult();
    eq("5. current actual_price = 360", j.body.actual_price, 360);
    eq("5. estimated_price = 380", j.body.estimated_price, 380);
    eq("5. price_diff = -20", j.body.price_diff, -20);
  }

  // 6) 校验: actual_price 缺失 -> 400
  {
    const r = makeReqRes({ body: {}, params: { id: "4" } });
    dispatch("POST", "/api/key_components/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("6. POST no actual_price -> 400", j.statusCode, 400);
  }

  // 7) 校验: actual_price 负数 -> 400
  {
    const r = makeReqRes({ body: { actual_price: -1 }, params: { id: "4" } });
    dispatch("POST", "/api/key_components/:id/prices", r.req, r.res);
    const j = r.getResult();
    eq("7. POST negative actual_price -> 400", j.statusCode, 400);
  }
}

console.log("");
console.log("# pass " + passed);
console.log("# fail " + failed);
process.exit(failed === 0 ? 0 : 1);