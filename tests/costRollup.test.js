"use strict";
// tests/costRollup.test.js
// 成本归集单测 (跑 npm test)
//
// 测什么:
//   1) GET /:id/cost_rollup 汇总 - 关键件价差 + 普通物料 + 工时
//   2) project_status: over_budget / partial / fully_contracted
//   3) 合同价高于估价 -> over_10pct
//   4) 不存在的 instance -> 404
//   5) GET /:id/cost_rollup/breakdown 明细行数 + 工时行存在
//   6) 工时超额 -> labor.cost_status = over_10pct
//   7) project_status: fully_contracted (全部签了且不超预算)
//   8) key_components 在该 instance BOM 中没有 -> 不出现在 rollup
//
// 怎么跑:
//   node tests/costRollup.test.js

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
    // users
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);",
    // materials  (estimated_unit_price 在 cost_rollup 会被引用)
    "CREATE TABLE materials (",
    "  id INTEGER PRIMARY KEY,",
    "  material_code TEXT, material_name TEXT, material_type TEXT, unit TEXT,",
    "  estimated_unit_price REAL DEFAULT 0",
    ");",
    // equipment_instances
    "CREATE TABLE equipment_instances (",
    "  id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT,",
    "  customer_name TEXT, contract_no TEXT,",
    "  contract_amount REAL, contract_amount_unit TEXT NOT NULL DEFAULT 'yuan',",
    "  status TEXT, progress_pct REAL",
    ");",
    // instance_bom
    "CREATE TABLE instance_bom (",
    "  id INTEGER PRIMARY KEY,",
    "  equipment_instance_id INTEGER, material_id INTEGER,",
    "  quantity REAL,",
    "  is_key_component INTEGER ",
    ");",
    // key_components
    "CREATE TABLE key_components (",
    "  id INTEGER PRIMARY KEY, material_id INTEGER, component_type TEXT, supplier TEXT,",
    "  unit_price REAL, last_price_id INTEGER",
    ");",
    // key_component_prices
    "CREATE TABLE key_component_prices (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  key_component_id INTEGER NOT NULL,",
    "  actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT,",
    "  currency TEXT NOT NULL DEFAULT 'CNY',",
    "  valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT,",
    "  priced_by INTEGER, priced_at TEXT NOT NULL",
    ");",
    // work_orders
    "CREATE TABLE work_orders (",
    "  id INTEGER PRIMARY KEY, equipment_instance_id INTEGER,",
    "  estimated_hours REAL DEFAULT 0, actual_hours REAL DEFAULT 0,",
    "  status TEXT",
    ");",
    // seed: 一个 project + 3 关键件 (其中 1 个签了超预算) + 2 普通物料 + 2 工单
    "INSERT INTO users VALUES (1, 'admin');",
    "INSERT INTO equipment_instances VALUES (1, 'TBM-001', 'XX 地铁 1 号线', 'XX 地铁', 'CN-2026-001', 5000, 'yuan', 'design', 0);",
    "INSERT INTO equipment_instances VALUES (2, 'TBM-002', 'YY 地铁 2 号线', 'YY 地铁', 'CN-2026-002', 3000, 'yuan', 'design', 0);",
    // materials
    "INSERT INTO materials VALUES (10, 'M-BRG', '主轴承', 'mech', 'pcs', 380);",
    "INSERT INTO materials VALUES (11, 'M-RED', '减速机', 'mech', 'pcs', 65);",
    "INSERT INTO materials VALUES (12, 'M-MOT', '驱动电机', 'mech', 'pcs', 22);",
    "INSERT INTO materials VALUES (20, 'M-BOLT', '螺栓 M30', 'std', 'pcs', 0.5);",
    "INSERT INTO materials VALUES (21, 'M-PLATE', '钢板 20mm', 'raw', 'kg', 8);",
    // key_components
    "INSERT INTO key_components VALUES (1, 10, 'main_bearing', 'SKF', 380, NULL);",
    "INSERT INTO key_components VALUES (2, 11, 'reducer', 'SEW', 65, NULL);",
    "INSERT INTO key_components VALUES (3, 12, 'drive_motor', 'ABB', 22, NULL);",
    // BOM: instance 1 用全部 3 关键件 + 2 普通物料; instance 2 只用 1 关键件
    "INSERT INTO instance_bom VALUES (1, 1, 10, 1, 1);",   // bearing x1
    "INSERT INTO instance_bom VALUES (2, 1, 11, 3, 1);",   // reducer x3
    "INSERT INTO instance_bom VALUES (3, 1, 12, 6, 1);",   // motor x6
    "INSERT INTO instance_bom VALUES (4, 1, 20, 200, 0);", // bolt x200
    "INSERT INTO instance_bom VALUES (5, 1, 21, 50, 0);",  // plate x50
    "INSERT INTO instance_bom VALUES (6, 2, 10, 1, 1);",   // instance2: bearing x1
    // work orders
    "INSERT INTO work_orders VALUES (1, 1, 100, 120, 'in_progress');",      // 估算 100, 实际 120 -> +20%
    "INSERT INTO work_orders VALUES (2, 1, 50,  30,  'completed');",       // 估算 50,  实际 30
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

console.log("=== costRollup ===");
{
  const db = makeDb();
  // costRollup 没用 auth.requireRole, 但 require cache 隔离避免污染
  delete require.cache[require.resolve("../services/cost/rollup/index")];
  const { register } = require("../services/cost/rollup/index");
  register(fakeApp, db);

  // 1) 基础 rollup (无合同价, 全部 no_contract_yet, project_status = partial)
  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    eq("1. status 200", j.statusCode, 200);
    eq("1. instance_code", j.body.equipment_instance.instance_code, "TBM-001");
    eq("1. key_components.count = 3", j.body.key_components.count, 3);
    eq("1. key_components.pending_count = 3", j.body.key_components.pending_count, 3);
    eq("1. key_components.contract_signed_count = 0", j.body.key_components.contract_signed_count, 0);
    // 关键件估价: 380*1 + 65*3 + 22*6 = 380 + 195 + 132 = 707
    eq("1. key.estimated_total = 707", j.body.key_components.estimated_total, 707);
    eq("1. key.actual_total = 707 (无合同按估价)", j.body.key_components.actual_total, 707);
    // 普通物料: 0.5*200 + 8*50 = 100 + 400 = 500
    eq("1. mat.count = 2", j.body.materials.count, 2);
    eq("1. mat.estimated_total = 500", j.body.materials.estimated_total, 500);
    eq("1. mat.actual_total = 500", j.body.materials.actual_total, 500);
    // 工时: 估算 150, 实际 150
    eq("1. labor.estimated_hours = 150", j.body.labor.estimated_hours, 150);
    eq("1. labor.actual_hours = 150", j.body.labor.actual_hours, 150);
    eq("1. labor.work_order_count = 2", j.body.labor.work_order_count, 2);
    // totals: 707 + 500 = 1207
    eq("1. totals.estimated_cost = 1207", j.body.totals.estimated_cost, 1207);
    eq("1. totals.actual_cost = 1207", j.body.totals.actual_cost, 1207);
    eq("1. totals.cost_diff = 0", j.body.totals.cost_diff, 0);
    eq("1. project_status = partial (有未签)", j.body.project_status, "partial");
    // contract_margin: 5000 - 1207
    eq("1. contract_margin = 3793 (合同 5000 元 - 实际 1207 元)", j.body.contract_margin, 3793);
       eq("1. contract_yuan = 5000 (contract_amount_unit=yuan)", j.body.contract_yuan, 5000);
       eq("1. contract_margin_pct = 75.86 (3793/5000*100)", j.body.contract_margin_pct, 75.86);
  }

  // 2) 给 bearing (kc.id=1) 签一个超预算合同 410 (> 380 7.9% 落在 0-10%, cost_status=over_10pct)
  db.prepare("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, valid_from, valid_to, priced_at) VALUES (1, 410, 'CN-K1', '2026-06-15', NULL, '2026-06-24 10:00:00')").run();
  const kcp = db.prepare("SELECT id FROM key_component_prices ORDER BY id DESC LIMIT 1").get();
  db.prepare("UPDATE key_components SET last_price_id = ? WHERE id = 1").run(kcp.id);

  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    eq("2. key.estimated_total = 707", j.body.key_components.estimated_total, 707);
    // actual: 410*1 + 65*3 + 22*6 = 410 + 195 + 132 = 737
    eq("2. key.actual_total = 737", j.body.key_components.actual_total, 737);
    eq("2. key.price_diff = 30", j.body.key_components.price_diff, 30);
    eq("2. key.contract_signed_count = 1", j.body.key_components.contract_signed_count, 1);
    eq("2. key.pending_count = 2", j.body.key_components.pending_count, 2);
    eq("2. key.over_budget_count = 1", j.body.key_components.over_budget_count, 1);
    eq("2. totals.cost_diff = 30", j.body.totals.cost_diff, 30);
    eq("2. totals.over_budget_diff = 30", j.body.totals.over_budget_diff, 30);
    eq("2. contract_margin = 3763", j.body.contract_margin, 3763);
       eq("2. contract_yuan = 5000 (unit=yuan)", j.body.contract_yuan, 5000);
       eq("2. contract_margin_pct = 75.26", j.body.contract_margin_pct, 75.26);
    eq("2. project_status = over_budget", j.body.project_status, "over_budget");
j.body.key_components.items ? j.body.key_components.items[0] : null;
    // items 字段不在 rollup, 在 breakdown. 这里只验证 price_diff
  }

  // 3) 再签一个不超预算的减速机 60 (< 65)
  db.prepare("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, valid_from, valid_from, valid_to, priced_at) VALUES (2, 60, 'CN-K2', '2026-06-15', '2026-06-15', NULL, '2026-06-24 10:00:00')").run();
  // 上面语句故意写两个 valid_from 列, SQLite 会用第二个, 但有语法歧义. 改用普通 insert
  // 改用正确 insert: 直接给 kc2 写价
  db.prepare("DELETE FROM key_component_prices WHERE key_component_id = 2").run();
db.prepare("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, valid_from, valid_to, priced_at) VALUES (2, 60, 'CN-K2', '2026-06-15', NULL, '2026-06-24 10:00:00')").run();
  const kc2 = db.prepare("SELECT id FROM key_component_prices WHERE key_component_id = 2 ORDER BY id DESC LIMIT 1").get();
  db.prepare("UPDATE key_components SET last_price_id = ? WHERE id = 2").run(kc2.id);

  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    // 关键件 actual: 410*1 + 60*3 + 22*6 = 410 + 180 + 132 = 722
    eq("3. key.actual_total = 722", j.body.key_components.actual_total, 722);
    eq("3. key.price_diff = 15", j.body.key_components.price_diff, 15);
    eq("3. key.contract_signed_count = 2", j.body.key_components.contract_signed_count, 2);
    eq("3. key.pending_count = 1", j.body.key_components.pending_count, 1);
    // 仍 over_budget (bearing 仍是超的)
    eq("3. project_status = over_budget", j.body.project_status, "over_budget");
    // over_budget_diff 仍是 30 (只有 bearing 超)
    eq("3. over_budget_diff = 30", j.body.totals.over_budget_diff, 30);
  }

  // 4) 不存在的 instance -> 404
  {
    const r = makeReqRes({ params: { id: "999" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    eq("4. status 404", r.getResult().statusCode, 404);
  }

  // 5) breakdown 明细 - 行数: 3 关键件 + 2 普通物料 + 1 工时 = 6
  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup/breakdown", r.req, r.res);
    const j = r.getResult();
    eq("5. breakdown status 200", j.statusCode, 200);
    eq("5. breakdown count = 6 (3 关键件+2 物料+1 工时)", j.body.count, 6);
    const types = j.body.items.map(i => i.line_type);
    eq("5. line_types = [key_component x3, material x2, labor x1]", JSON.stringify(types.sort()),
       JSON.stringify(["key_component", "key_component", "key_component", "labor", "material", "material"]));
    const labor = j.body.items.find(i => i.line_type === "labor");
    eq("5. labor estimated_total = 150", labor.estimated_total, 150);
    eq("5. labor actual_total = 150", labor.actual_total, 150);
    eq("5. labor price_diff = 0", labor.price_diff, 0);
    // 验证 over_budget 关键件在 breakdown 也标记对
    const bearing = j.body.items.find(i => i.component_type === "main_bearing");
    eq("5. bearing cost_status = over_10pct", bearing.cost_status, "over_10pct");
    eq("5. bearing price_diff = 30", bearing.price_diff, 30);
    const reducer = j.body.items.find(i => i.component_type === "reducer");
    eq("5. reducer cost_status = on_or_under_budget", reducer.cost_status, "on_or_under_budget");
    eq("5. reducer price_diff = -15 (60*3 - 65*3)", reducer.price_diff, -15);
  }

  // 6) 工时超额 - 在 instance 1 的 wo1 把 actual 改大, 触发 over_10pct
  db.prepare("UPDATE work_orders SET actual_hours = 200 WHERE id = 1").run();
  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup/breakdown", r.req, r.res);
    const j = r.getResult();
    const labor = j.body.items.find(i => i.line_type === "labor");
    eq("6. labor actual_total = 230 (200+30)", labor.actual_total, 230);
    eq("6. labor price_diff = 80", labor.price_diff, 80);
    eq("6. labor cost_status = over_10pct", labor.cost_status, "over_10pct");
  }

  // 7) fully_contracted - 给剩余电机也签一个 22 (= 估价) -> 全签, 无超
  db.prepare("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, valid_from, valid_to, priced_at) VALUES (3, 22, 'CN-K3', '2026-06-15', NULL, '2026-06-24 10:00:00')").run();
  const kc3 = db.prepare("SELECT id FROM key_component_prices WHERE key_component_id = 3 ORDER BY id DESC LIMIT 1").get();
  db.prepare("UPDATE key_components SET last_price_id = ? WHERE id = 3").run(kc3.id);
  // bearing 也调成不超预算
  db.prepare("UPDATE key_component_prices SET actual_price = 380 WHERE key_component_id = 1").run();
  {
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    eq("7. key.contract_signed_count = 3", j.body.key_components.contract_signed_count, 3);
    eq("7. key.pending_count = 0", j.body.key_components.pending_count, 0);
    eq("7. key.over_budget_count = 0", j.body.key_components.over_budget_count, 0);
    eq("7. project_status = fully_contracted", j.body.project_status, "fully_contracted");
    eq("7. totals.cost_diff = -15 (reducer 60*3 vs 65*3)", j.body.totals.cost_diff, -15);
  }


  // 9) contract_amount_unit='wan' 换算: contract_amount=5000 'wan' = 50,000,000 元
  {
    db.prepare("UPDATE equipment_instances SET contract_amount_unit='wan' WHERE id=1").run();
    const r = makeReqRes({ params: { id: "1" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    eq("9. contract_amount_unit = wan", j.body.equipment_instance.contract_amount_unit, "wan");
    eq("9. contract_yuan = 50000000 (5000 万)", j.body.contract_yuan, 50000000);
    eq("9. contract_margin = 50000000 - 1192 = 49998808", j.body.contract_margin, 49998808);
    // pct: 49998793 / 50000000 * 100 = 99.99759
    eq("9. contract_margin_pct ~= 99.998", j.body.contract_margin_pct, 100);
    // 还原
    db.prepare("UPDATE equipment_instances SET contract_amount_unit='yuan' WHERE id=1").run();
  }

  // 8) BOM 中没有用到的关键件不出现在 instance 2 rollup
  // instance 2 只 BOM 了 bearing (kc=1), 关键件表里有 3 个
  {
    const r = makeReqRes({ params: { id: "2" } });
    dispatch("GET", "/api/equipment_instances/:id/cost_rollup", r.req, r.res);
    const j = r.getResult();
    eq("8. instance2 key.count = 1 (只 BOM 了一个)", j.body.key_components.count, 1);
    eq("8. instance2 materials.count = 0", j.body.materials.count, 0);
    eq("8. instance2 key.estimated_total = 380", j.body.key_components.estimated_total, 380);
  }
}

console.log("---");
console.log("passed:", passed, "failed:", failed);
process.exit(failed === 0 ? 0 : 1);


