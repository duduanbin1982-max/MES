"use strict";
// tests/readModelViews.test.js
// 2026-11-02：报表只读视图（read model）—— 跨域聚合读的统一入口。
// 覆盖：视图创建幂等、看板计数、实例健康指标、现场实时状态、长交期筛选。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { ensureReadModel, READ_MODEL_VIEWS } = require("../services/reportService/schema");

const TABLE_DDL = [
  "CREATE TABLE equipment_types (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1)",
  "CREATE TABLE equipment_models (id INTEGER PRIMARY KEY)",
  `CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT,
     status TEXT, lifecycle_stage TEXT, progress_pct INTEGER, contract_no TEXT)`,
  `CREATE TABLE work_orders (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, planned_end TEXT,
     status TEXT, workstation_id INTEGER)`,
  `CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, planned_end TEXT,
     planned_start TEXT, status TEXT, required_workstation_id INTEGER)`,
  "CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, material_lot_id INTEGER)",
  "CREATE TABLE key_components (id INTEGER PRIMARY KEY, material_id INTEGER, lead_time_weeks INTEGER, supplier TEXT, unit_price REAL)",
  "CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT)",
  "CREATE TABLE instance_eco (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, status TEXT)",
  "CREATE TABLE field_service (id INTEGER PRIMARY KEY, status TEXT)",
  "CREATE TABLE instance_milestones (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, phase_code TEXT, phase_name TEXT)",
  "CREATE TABLE material_movements (id INTEGER PRIMARY KEY, movement_type TEXT, work_order_id INTEGER)",
  "CREATE TABLE serial_numbers (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER)",
  "CREATE TABLE qc_inspections (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER)",
  "CREATE TABLE work_order_qc (id INTEGER PRIMARY KEY, work_order_id INTEGER)",
  "CREATE TABLE weld_records (id INTEGER PRIMARY KEY, work_order_id INTEGER)",
  "CREATE TABLE ndt_records (id INTEGER PRIMARY KEY, work_order_id INTEGER)",
  "CREATE TABLE assembly_records (id INTEGER PRIMARY KEY, work_order_id INTEGER)",
  "CREATE TABLE documents (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, work_order_id INTEGER)",
  "CREATE TABLE project_cost_entries (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, deleted_at TEXT, cost_type TEXT)",
  "CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY, work_order_id INTEGER, hours_worked REAL)",
];

function past(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function freshDb() {
  const db = new Database(":memory:");
  for (const sql of TABLE_DDL) db.exec(sql);
  ensureReadModel(db);
  return db;
}

function seed(db) {
  // 两个实例：#1 数据较厚、#2 空壳
  db.exec(`
    INSERT INTO equipment_instances (id, instance_code, instance_name, status, lifecycle_stage, progress_pct, contract_no)
    VALUES (1, 'TBM-T-001', '测试机一', 'in_production', 'manufacturing', 40, 'HT-001'),
           (2, 'TBM-T-002', '测试机二', 'design', 'design', 0, NULL);
    INSERT INTO instance_milestones (id, equipment_instance_id, phase_code, phase_name) VALUES
      (1, 1, 'S1', '设计冻结'), (2, 1, 'S9', '试掘进/验收'), (3, 2, 'S1', '设计冻结');
    INSERT INTO instance_bom (id, equipment_instance_id, material_id, material_lot_id) VALUES
      (1, 1, 11, 21), (2, 1, 12, NULL), (3, 1, NULL, NULL), (4, 2, NULL, NULL);
    INSERT INTO instance_eco (id, equipment_instance_id, status) VALUES (1, 1, 'open');
    INSERT INTO process_nodes (id, equipment_instance_id, planned_end, planned_start, status, required_workstation_id) VALUES
      (1, 1, '2026-10-01 00:00:00', '2026-09-01 00:00:00', 'in_progress', 3),
      (2, 1, NULL, NULL, 'blocked', NULL);
    INSERT INTO work_orders (id, equipment_instance_id, planned_end, status, workstation_id) VALUES
      (1, 1, ${'?'}, 'in_progress', 3),
      (2, 1, NULL, 'pending', NULL),
      (3, 2, NULL, 'pending', NULL);
  `.replace("?", `'${past(3)}'`));
  db.exec(`
    INSERT INTO work_order_operations (id, work_order_id, hours_worked) VALUES (1, 1, 8), (2, 1, 0);
    INSERT INTO material_movements (id, movement_type, work_order_id) VALUES (1, 'issue', 1), (2, 'receipt', 1);
    INSERT INTO serial_numbers (id, equipment_instance_id) VALUES (1, 1);
    INSERT INTO qc_inspections (id, equipment_instance_id) VALUES (1, 1);
    INSERT INTO work_order_qc (id, work_order_id) VALUES (1, 1);
    INSERT INTO weld_records (id, work_order_id) VALUES (1, 1);
    INSERT INTO ndt_records (id, work_order_id) VALUES (1, 1);
    INSERT INTO assembly_records (id, work_order_id) VALUES (1, 1);
    INSERT INTO documents (id, equipment_instance_id, work_order_id) VALUES (1, 1, NULL), (2, NULL, 1);
    INSERT INTO project_cost_entries (id, equipment_instance_id, deleted_at, cost_type) VALUES
      (1, 1, NULL, 'material'), (2, 1, NULL, 'labor'), (3, 1, '2026-10-01', 'material');
    INSERT INTO key_components (id, material_id, lead_time_weeks, supplier, unit_price) VALUES
      (1, 11, 16, '供应商A', 100), (2, 12, 4, '供应商B', 50);
    INSERT INTO materials (id, material_code, material_name) VALUES (11, 'WG-001', '主轴承'), (12, 'BOLT-01', '螺栓');
    INSERT INTO field_service (id, status) VALUES (1, 'open');
  `);
}

test("RMV.1 只读视图创建幂等，且 8 个视图齐全", () => {
  const db = new Database(":memory:");
  for (const sql of TABLE_DDL) db.exec(sql);
  ensureReadModel(db);
  ensureReadModel(db); // 幂等
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(names, [
    "v_dashboard_counts",
    "v_instance_health_metrics",
    "v_instance_live_status",
    "v_instance_status_counts",
    "v_long_leadtime_components",
    "v_process_node_status_counts",
    "v_risk_counts",
    "v_work_order_status_counts",
  ]);
  assert.equal(READ_MODEL_VIEWS.length, 8);
  db.close();
});

test("RMV.1b v_dashboard_counts 内联了风险口径（同一次查询可复用）", () => {
  const db = freshDb();
  seed(db);
  const risk = db.prepare("SELECT * FROM v_risk_counts").get();
  const board = db.prepare("SELECT * FROM v_dashboard_counts").get();
  assert.equal(risk.work_order_delays, board.work_order_delays);
  assert.equal(risk.long_leadtime, board.long_leadtime);
  assert.equal(risk.open_eco, board.open_eco);
  db.close();
});

test("RMV.2 v_dashboard_counts：头部计数与延误口径一次查出", () => {
  const db = freshDb();
  seed(db);
  const counts = db.prepare("SELECT * FROM v_dashboard_counts").get();
  assert.equal(counts.instances_total, 2);
  assert.equal(counts.work_orders_total, 3);
  assert.equal(counts.process_nodes_total, 2);
  assert.equal(counts.bom_total, 4);
  assert.equal(counts.key_components_total, 2);
  assert.equal(counts.long_leadtime, 1, "只有 16 周的关键件算长交期");
  assert.equal(counts.open_eco, 1);
  assert.equal(counts.open_field_service, 1);
  assert.equal(counts.work_order_delays, 1, "工单#1 计划结束已过且进行中");
  db.close();
});

test("RMV.3 v_instance_health_metrics：8 环节指标按实例一次成型", () => {
  const db = freshDb();
  seed(db);
  const row = db.prepare("SELECT * FROM v_instance_health_metrics WHERE instance_id = 1").get();
  assert.equal(row.milestones, 2);
  assert.equal(row.has_contract, 1);
  assert.equal(row.bom_rows, 3);
  assert.equal(row.bom_with_material, 2);
  assert.equal(row.bom_with_lot, 1);
  assert.equal(row.lots, 1, "已挂批次按去重算");
  assert.equal(row.eco, 1);
  assert.equal(row.nodes, 2);
  assert.equal(row.nodes_scheduled, 1);
  assert.equal(row.nodes_with_workstation, 1);
  assert.equal(row.blocked_nodes, 1);
  assert.equal(row.work_orders, 2);
  assert.equal(row.work_orders_with_workstation, 1);
  assert.equal(row.active_orders, 1);
  assert.equal(row.operations_with_hours, 1, "只算有工时的报工");
  assert.equal(row.issue_movements, 1, "只算领料流水");
  assert.equal(row.serials, 1);
  assert.equal(row.inspections, 1);
  assert.equal(row.work_order_qc, 1);
  assert.equal(row.welds, 1);
  assert.equal(row.ndt, 1);
  assert.equal(row.assembly, 1);
  assert.equal(row.documents, 2, "直接挂实例 + 挂工单的都要算");
  assert.equal(row.delivery_milestones, 1);
  assert.equal(row.cost_entries, 2, "已删除的不算");
  assert.equal(row.cost_types, 2, "material + labor");

  const empty = db.prepare("SELECT * FROM v_instance_health_metrics WHERE instance_id = 2").get();
  assert.equal(empty.milestones, 1);
  assert.equal(empty.has_contract, 0);
  assert.equal(empty.bom_rows, 1);
  assert.equal(empty.bom_with_material, 0);
  db.close();
});

test("RMV.4 v_instance_live_status：在健康指标上收敛出实时状态", () => {
  const db = freshDb();
  seed(db);
  const rows = db.prepare("SELECT * FROM v_instance_live_status ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].active_orders, 1);
  assert.equal(rows[0].blocked_nodes, 1);
  assert.equal(rows[1].active_orders, 0);
  db.close();
});

test("RMV.5 v_long_leadtime_components：只暴露 >=12 周且带物料信息", () => {
  const db = freshDb();
  seed(db);
  const rows = db.prepare("SELECT * FROM v_long_leadtime_components ORDER BY lead_time_weeks DESC").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].material_code, "WG-001");
  assert.equal(rows[0].lead_time_weeks, 16);
  db.close();
});

test("RMV.7 process_nodes 重建（修 FK）时依赖视图不被打断", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY);
    CREATE TABLE instance_bom_v22 (id INTEGER PRIMARY KEY);
    CREATE TABLE workstations (id INTEGER PRIMARY KEY);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      material_lot_id INTEGER,
      bom_node_id INTEGER REFERENCES instance_bom_v22(id),
      required_workstation_id INTEGER REFERENCES workstations(id)
    );
    CREATE VIEW v_node_count AS SELECT COUNT(*) AS c FROM process_nodes;
    CREATE VIEW v_node_count_derived AS SELECT c FROM v_node_count;
    CREATE VIEW v_unrelated AS SELECT 1 AS c;
  `);
  db.prepare("INSERT INTO instance_bom (id) VALUES (1)").run();
  db.prepare("INSERT INTO instance_bom_v22 (id) VALUES (1)").run();
  db.prepare("INSERT INTO process_nodes (id, material_lot_id, bom_node_id) VALUES (1, 9, 1)").run();

  const { repairProcessNodesBomForeignKey, collectDependentViews } = require("../services/processTree/repairBomForeignKey");
  const dependents = collectDependentViews(db, "process_nodes").map((view) => view.name);
  assert.deepEqual(dependents, ["v_node_count", "v_node_count_derived"], "直接与间接依赖都要收集");

  assert.equal(repairProcessNodesBomForeignKey(db), true, "应执行重建");
  const fkRows = db.prepare("PRAGMA foreign_key_list(process_nodes)").all();
  assert.equal(fkRows.find((row) => row.from === "bom_node_id").table, "instance_bom", "重建后 FK 指向 instance_bom");
  assert.equal(fkRows.find((row) => row.from === "material_lot_id" || row.from === "required_workstation_id").table !== "process_nodes_fk_repair", true, "自引用不能残留临时表名");
  assert.equal(db.prepare("SELECT c FROM v_node_count").get().c, 1, "直接依赖视图仍可查询");
  assert.equal(db.prepare("SELECT c FROM v_node_count_derived").get().c, 1, "间接依赖视图仍可查询");
  assert.equal(db.prepare("SELECT c FROM v_unrelated").get().c, 1, "无关视图不受影响");
  db.close();
});

test("RMV.8 process_nodes 重建时：引用视图的触发器也能安全恢复", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY);
    CREATE TABLE instance_bom_v22 (id INTEGER PRIMARY KEY);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, status TEXT, progress_cache INTEGER);
    CREATE TABLE process_nodes (
      id INTEGER PRIMARY KEY,
      equipment_instance_id INTEGER,
      status TEXT,
      bom_node_id INTEGER REFERENCES instance_bom_v22(id)
    );
    CREATE VIEW v_node_done AS SELECT COUNT(*) AS c FROM process_nodes WHERE status = 'completed';
    CREATE TRIGGER trg_wo_sync AFTER UPDATE ON work_orders
    BEGIN UPDATE work_orders SET progress_cache = (SELECT c FROM v_node_done) WHERE id = NEW.id; END;
  `);
  db.exec("INSERT INTO instance_bom (id) VALUES (1); INSERT INTO instance_bom_v22 (id) VALUES (1)");
  db.exec("INSERT INTO process_nodes (id, equipment_instance_id, status, bom_node_id) VALUES (1, 1, 'completed', 1)");
  db.exec("INSERT INTO work_orders (id, status, progress_cache) VALUES (1, 'pending', 0)");

  const { repairProcessNodesBomForeignKey } = require("../services/processTree/repairBomForeignKey");
  assert.equal(repairProcessNodesBomForeignKey(db), true, "应执行重建");
  // 视图与触发器都要还在，且触发器仍能工作
  assert.equal(db.prepare("SELECT c FROM v_node_done").get().c, 1);
  db.prepare("UPDATE work_orders SET status = 'in_progress' WHERE id = 1").run();
  assert.equal(db.prepare("SELECT progress_cache FROM work_orders WHERE id = 1").get().progress_cache, 1, "触发器应能正常执行");
  const fk = db.prepare("PRAGMA foreign_key_list(process_nodes)").all().find((row) => row.from === "bom_node_id");
  assert.equal(fk.table, "instance_bom");
  db.close();
});
test("RMV.6 看板服务改读视图后接口正常（含健康检查整页一次查询）", () => {
  const db = freshDb();
  seed(db);
  const routes = {};
  const app = {
    get: (path, ...handlers) => { routes[path] = handlers; },
    post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
  };
  require("../services/reportService/dashboard").register(app, db);

  const call = (path, query = {}) => {
    let body = null;
    const res = { status() { return this; }, json(value) { body = value; return this; } };
    for (const handler of routes[path]) handler({ query, body: {}, params: {} }, res);
    return body;
  };

  const dashboard = call("/api/dashboard");
  assert.equal(dashboard.instances.total, 2);
  assert.equal(dashboard.work_orders.total, 3);
  assert.equal(dashboard.bom_total, 4);
  assert.ok(Array.isArray(dashboard.work_orders.by_status));

  const health = call("/api/dashboard/process-health");
  assert.equal(health.instances.length, 2);
  assert.ok(health.instances[0].score > 0, "实例 1 应有分数");
  const bom = health.selected.stages.find((stage) => stage.key === "design_bom");
  assert.ok(bom, "选中实例应包含设计与 BOM 环节");

  const one = call("/api/dashboard/process-health", { instance_id: "2" });
  assert.equal(one.selected.instance_id, 2);
  db.close();
});
