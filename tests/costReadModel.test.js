"use strict";
// tests/costReadModel.test.js
// 2026-11-02：成本归集的只读视图（services/cost/rollup/readModel.js）
// 覆盖：视图幂等、明细行 vs 聚合行两种粒度、合同摘要、工时零值、成本台账过滤、接口联通。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { ensureReadModel, COST_READ_MODEL_VIEWS } = require("../services/cost/rollup/readModel");
const queries = require("../services/cost/rollup/queries");

const TABLE_DDL = [
  `CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT,
     customer_name TEXT, contract_no TEXT, contract_amount REAL,
     contract_amount_unit TEXT NOT NULL DEFAULT 'yuan', status TEXT, progress_pct REAL)`,
  "CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT, material_type TEXT, unit TEXT, estimated_unit_price REAL DEFAULT 0)",
  "CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER)",
  "CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, component_type TEXT, supplier TEXT, unit_price REAL, last_price_id INTEGER)",
  `CREATE TABLE key_component_prices (id INTEGER PRIMARY KEY AUTOINCREMENT, key_component_id INTEGER NOT NULL,
     actual_price REAL NOT NULL, contract_no TEXT, vendor_po TEXT, currency TEXT NOT NULL DEFAULT 'CNY',
     valid_from TEXT NOT NULL, valid_to TEXT, notes TEXT, priced_by INTEGER, priced_at TEXT NOT NULL)`,
  "CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, estimated_hours REAL DEFAULT 0, actual_hours REAL DEFAULT 0, status TEXT)",
  "CREATE TABLE project_cost_entries (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, bom_node_id INTEGER, cost_type TEXT, description TEXT, currency TEXT, amount REAL, source_ref TEXT, source_type TEXT, vendor TEXT, occurred_on TEXT, notes TEXT, status TEXT, deleted_at TEXT)",
];

function freshDb() {
  const db = new Database(":memory:");
  for (const sql of TABLE_DDL) db.exec(sql);
  ensureReadModel(db);
  return db;
}

function seed(db) {
  db.exec(`
    INSERT INTO equipment_instances (id, instance_code, instance_name, customer_name, contract_no, contract_amount, contract_amount_unit, status, progress_pct)
    VALUES (1, 'TBM-C-001', '成本样机', '客户A', 'CN-001', 5000000, 'yuan', 'in_production', 40),
           (2, 'TBM-C-002', '空壳机', NULL, NULL, NULL, 'wan', 'design', 0);
    INSERT INTO materials (id, material_code, material_name, material_type, unit, estimated_unit_price) VALUES
      (10, 'M-BRG', '主轴承', 'mech', 'pcs', 380),
      (20, 'M-BOLT', '螺栓', 'std', 'pcs', 0.5),
      (21, 'M-PLATE', '钢板', 'raw', 'kg', 8);
    INSERT INTO key_components (id, material_id, component_type, supplier, unit_price, last_price_id) VALUES (1, 10, 'main_bearing', 'SKF', 380, NULL);
    INSERT INTO instance_bom (id, equipment_instance_id, material_id, quantity, is_key_component) VALUES
      (1, 1, 10, 1, 1),
      (2, 1, 20, 200, 0),
      (3, 1, 20, 100, 0),
      (4, 1, 21, 50, 0);
    INSERT INTO work_orders (id, equipment_instance_id, estimated_hours, actual_hours, status) VALUES
      (1, 1, 100, 120, 'in_progress'),
      (2, 1, 50, 30, 'completed');
    INSERT INTO project_cost_entries (id, equipment_instance_id, bom_node_id, cost_type, description, currency, amount, source_ref, source_type, vendor, occurred_on, notes, status, deleted_at) VALUES
      (1, 1, NULL, 'outsourcing', '外协加工', 'CNY', 1000, 'PO-1', 'import', '洛阳', '2026-10-01', NULL, 'posted', NULL),
      (2, 1, NULL, 'depreciation', '折旧', 'CNY', 500, NULL, 'manual', NULL, '2026-10-02', NULL, 'posted', NULL),
      (3, 1, NULL, 'material', '作废行', 'CNY', 999, NULL, 'manual', NULL, '2026-10-03', NULL, 'void', NULL),
      (4, 1, NULL, 'rework', '已删除', 'CNY', 777, NULL, 'manual', NULL, '2026-10-04', NULL, 'posted', '2026-10-05');
  `);
}

test("CRM.1 视图创建幂等，7 个视图齐全", () => {
  const db = new Database(":memory:");
  for (const sql of TABLE_DDL) db.exec(sql);
  ensureReadModel(db);
  ensureReadModel(db);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(names, [
    "v_instance_bom_key_component_lines",
    "v_instance_bom_material_lines",
    "v_instance_contract_summary",
    "v_instance_cost_entry_lines",
    "v_instance_key_component_costs",
    "v_instance_labor_totals",
    "v_instance_material_costs",
  ]);
  assert.equal(COST_READ_MODEL_VIEWS.length, 7);
  db.close();
});

test("CRM.2 明细行 vs 聚合行：同一物料两行 BOM → lines 2 条、costs 1 条且数量合计", () => {
  const db = freshDb();
  seed(db);
  const lines = db.prepare("SELECT * FROM v_instance_bom_material_lines WHERE instance_id = 1 AND material_id = 20").all();
  assert.equal(lines.length, 2, "明细保持每行 BOM 一条");
  const agg = db.prepare("SELECT * FROM v_instance_material_costs WHERE instance_id = 1 AND material_id = 20").get();
  assert.equal(agg.quantity, 300, "聚合把 200+100 合起来");
  db.close();
});

test("CRM.3 v_instance_contract_summary：成本归集需要的实例字段", () => {
  const db = freshDb();
  seed(db);
  const row = db.prepare("SELECT * FROM v_instance_contract_summary WHERE id = 1").get();
  assert.equal(row.instance_code, "TBM-C-001");
  assert.equal(row.customer_name, "客户A");
  assert.equal(row.contract_amount, 5000000);
  assert.equal(row.contract_amount_unit, "yuan");
  assert.equal(db.prepare("SELECT * FROM v_instance_contract_summary WHERE id = 999").get(), undefined);
  db.close();
});

test("CRM.4 v_instance_labor_totals：无工单的实例也返回一行 0", () => {
  const db = freshDb();
  seed(db);
  const withWo = db.prepare("SELECT * FROM v_instance_labor_totals WHERE instance_id = 1").get();
  assert.equal(withWo.estimated_hours, 150);
  assert.equal(withWo.actual_hours, 150);
  assert.equal(withWo.work_order_count, 2);
  assert.equal(withWo.completed_count, 1);
  const empty = db.prepare("SELECT * FROM v_instance_labor_totals WHERE instance_id = 2").get();
  assert.ok(empty, "空实例也要有行，保持改造前返回 0 的行为");
  assert.equal(empty.estimated_hours, 0);
  assert.equal(empty.work_order_count, 0);
  assert.equal(empty.completed_count, null, "没有工单时 completed_count 保持 NULL（与改造前逐字节一致）");
  db.close();
});

test("CRM.5 v_instance_cost_entry_lines：过滤作废/已删除，并给出中文类型标签", () => {
  const db = freshDb();
  seed(db);
  const rows = db.prepare("SELECT * FROM v_instance_cost_entry_lines WHERE instance_id = 1 ORDER BY item_id").all();
  assert.deepEqual(rows.map((row) => row.item_id), [1, 2], "void 与 deleted_at 不出现");
  assert.equal(rows[0].cost_type_label, "外协");
  assert.equal(rows[1].cost_type_label, "折旧");
  db.close();
});

test("CRM.6 共享 SQL 常量已改为读视图（防止回退成直接读业务表）", () => {
  for (const [name, sql] of Object.entries(queries)) {
    if (typeof sql !== "string" || !/^\s*SELECT/i.test(sql)) continue;
    assert.match(sql, /FROM v_instance_/i, `${name} 应读 v_instance_* 视图`);
  }
});

test("CRM.7 成本归集接口改读视图后仍正常（rollup + breakdown）", () => {
  const db = freshDb();
  seed(db);
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes[path] = handlers; },
    post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
  };
  require("../services/cost/rollup/index").register(app, db);
  const call = (path) => {
    let status = 200;
    let body = null;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    for (const handler of routes[path]) handler({ params: { id: "1" }, query: {}, body: {} }, res);
    return { status, body };
  };

  const rollup = call("/api/equipment_instances/:id/cost_rollup");
  assert.equal(rollup.status, 200);
  assert.equal(rollup.body.equipment_instance.instance_code, "TBM-C-001");
  assert.equal(rollup.body.key_components.count, 1);
  assert.equal(rollup.body.key_components.estimated_total, 380);
  assert.equal(rollup.body.materials.count, 2, "螺栓 + 钢板两种物料");
  assert.equal(rollup.body.materials.estimated_total, 550, "0.5*300 + 8*50");
  assert.equal(rollup.body.labor.estimated_hours, 150);

  const breakdown = call("/api/equipment_instances/:id/cost_rollup/breakdown");
  assert.equal(breakdown.status, 200);
  assert.equal(breakdown.body.count, 1 + 3 + 2 + 1, "1 关键件 + 3 行物料 + 2 行台账 + 1 工时");
  const labor = breakdown.body.items.find((item) => item.line_type === "labor");
  assert.equal(labor.estimated_total, 150);
  assert.equal(labor.actual_total, 150);
  assert.equal(labor.cost_status, "on_or_under_budget", "实际=估算，不算超支");
  const outsourcing = breakdown.body.items.find((item) => item.line_type === "project_cost_entry" && item.cost_type === "outsourcing");
  assert.equal(outsourcing.estimated_total, 1000);
  assert.equal(outsourcing.cost_type_label, "外协");
  db.close();
});
