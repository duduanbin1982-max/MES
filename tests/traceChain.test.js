"use strict";
// tests/traceChain.test.js
// P0-2（2026-10-18）：追溯五级链路 —— 软关联 schema、链路组装、断点检测、覆盖率。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { ensureChainSchema } = require("../services/trace/chainSchema");
const { buildChain, resolveAnchor, registerChainRoutes } = require("../services/trace/chain");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT, instance_name TEXT, status TEXT);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT, title TEXT, status TEXT, equipment_instance_id INTEGER);
    CREATE TABLE work_order_operations (id INTEGER PRIMARY KEY, work_order_id INTEGER, operator_id INTEGER, action TEXT, timestamp TEXT, hours_worked REAL, quantity_completed INTEGER, defect_quantity INTEGER, notes TEXT, photos TEXT);
    CREATE TABLE process_nodes (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, operation_name TEXT, phase_code TEXT, status TEXT, sequence INTEGER);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, material_id INTEGER, quantity REAL, is_key_component INTEGER);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, material_id INTEGER, lot_no TEXT, supplier TEXT, heat_no TEXT, certificate_no TEXT, received_date TEXT, quantity REAL, unit TEXT, quality_status TEXT, notes TEXT);
    CREATE TABLE material_movements (id INTEGER PRIMARY KEY, material_lot_id INTEGER, movement_type TEXT, quantity REAL, work_order_id INTEGER, project_id INTEGER, created_at TEXT);
    CREATE TABLE serial_numbers (id INTEGER PRIMARY KEY, serial_no TEXT, lot_id INTEGER, equipment_instance_id INTEGER, status TEXT, notes TEXT);
    CREATE TABLE serial_movements (id INTEGER PRIMARY KEY, serial_id INTEGER, lot_id INTEGER, work_order_id INTEGER, equipment_instance_id INTEGER, movement_type TEXT, quantity REAL, moved_by INTEGER, moved_at TEXT, notes TEXT);
    CREATE TABLE qc_inspections (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, work_order_id INTEGER, inspection_type TEXT, result TEXT, inspector_id INTEGER, inspection_date TEXT, notes TEXT);
    CREATE TABLE work_order_qc (id INTEGER PRIMARY KEY, work_order_id INTEGER, qc_type TEXT, result TEXT);
    CREATE TABLE weld_records (id INTEGER PRIMARY KEY, work_order_id INTEGER, weld_no TEXT, welder_id INTEGER, material_lot_id INTEGER, inspection_result TEXT, welding_procedure TEXT, created_at TEXT);
    CREATE TABLE ndt_records (id INTEGER PRIMARY KEY, work_order_id INTEGER, weld_record_id INTEGER, ndt_method TEXT, ndt_grade TEXT, result TEXT, report_no TEXT);
    CREATE TABLE assembly_records (id INTEGER PRIMARY KEY, work_order_id INTEGER, step_no INTEGER, step_name TEXT, operator_id INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, doc_type TEXT, doc_no TEXT, title TEXT, status TEXT, version TEXT);
    INSERT INTO users (id, full_name) VALUES (1, '张三');
    INSERT INTO equipment_instances (id, instance_code, instance_name, status) VALUES (1, 'TBM-2026-001', '1号盾构机', 'active');
    INSERT INTO work_orders (id, wo_code, title, status, equipment_instance_id) VALUES (1, 'WO-001', '前盾焊接', 'completed', 1);
    INSERT INTO work_order_operations (id, work_order_id, operator_id, action, timestamp) VALUES (1, 1, 1, 'start', '2026-06-01 08:00:00'), (2, 1, 1, 'complete', '2026-06-02 18:00:00');
    INSERT INTO process_nodes (id, equipment_instance_id, operation_name, phase_code, status, sequence) VALUES (1, 1, '下料', 'P1', 'completed', 1);
    INSERT INTO materials (id, material_code, material_name) VALUES (1, 'M-001', 'Q355 钢板');
    INSERT INTO material_lots (id, material_id, lot_no, supplier, heat_no, certificate_no) VALUES (1, 1, 'LOT-2026-001', '宝钢', 'H-8899', 'CERT-001');
    INSERT INTO material_movements (id, material_lot_id, movement_type, quantity, work_order_id) VALUES (1, 1, 'issue', 10, 1);
    INSERT INTO serial_numbers (id, serial_no, lot_id, equipment_instance_id, status) VALUES (1, 'SN-0001', 1, 1, 'assembled');
    INSERT INTO serial_movements (id, serial_id, lot_id, work_order_id, equipment_instance_id, movement_type) VALUES (1, 1, 1, 1, 1, 'assemble');
    INSERT INTO qc_inspections (id, equipment_instance_id, work_order_id, inspection_type, result, inspector_id, inspection_date) VALUES (1, 1, 1, 'in_process', 'pass', 1, '2026-06-02');
    INSERT INTO weld_records (id, work_order_id, weld_no, welder_id, material_lot_id, inspection_result) VALUES (1, 1, 'W-001', 1, 1, 'pass');
    INSERT INTO ndt_records (id, work_order_id, weld_record_id, ndt_method, ndt_grade, result, report_no) VALUES (1, 1, 1, 'UT', 'I', 'pass', 'RPT-001');
    INSERT INTO assembly_records (id, work_order_id, step_no, step_name, operator_id) VALUES (1, 1, 1, '盾体合拢', 1);
    INSERT INTO documents (id, equipment_instance_id, doc_type, doc_no, title, status, version) VALUES (1, 1, 'work_instruction', 'DOC-001', '前盾焊接指导书', 'issued', 'V1');
    INSERT INTO instance_bom (id, equipment_instance_id, material_id, quantity, is_key_component) VALUES (1, 1, 1, 10, 1);
  `);
  return db;
}

const queries = (db) => ({
  all: (sql, params = []) => db.prepare(sql).all(params),
  get: (sql, params = []) => db.prepare(sql).get(params),
});

test("TC.1 ensureChainSchema：补软关联列 + 索引 + 回填可推导值（幂等）", () => {
  const db = freshDb();
  const first = ensureChainSchema(db);
  assert.ok(first.added.length >= 10, "应补 10 个软关联列，实际: " + first.added.join(","));
  // weld / assembly 的 equipment_instance_id 由工单回填
  assert.equal(db.prepare("SELECT equipment_instance_id FROM weld_records WHERE id=1").get().equipment_instance_id, 1);
  assert.equal(db.prepare("SELECT equipment_instance_id FROM assembly_records WHERE id=1").get().equipment_instance_id, 1);
  // serial 的 work_order_id 由 movements 回填
  assert.equal(db.prepare("SELECT work_order_id FROM serial_numbers WHERE id=1").get().work_order_id, 1);
  // 幂等：再跑一次不报错、不重复加列
  const second = ensureChainSchema(db);
  assert.deepEqual(second.added, []);
  assert.equal(second.backfilled.weld_records || 0, 0, "已回填过不应再变");
  db.close();
});

test("TC.2 从序列号查询：五级链路全部 ok，无断点", () => {
  const db = freshDb();
  ensureChainSchema(db);
  // 补齐"设计 BOM ↔ 实装批次"的软关联（P0-2 新增列），此时链路才完整
  db.prepare("UPDATE instance_bom SET material_lot_id = 1 WHERE id = 1").run();
  const anchor = resolveAnchor(queries(db), { query: { serial_no: "SN-0001" } });
  assert.equal(anchor.found, true);
  assert.equal(anchor.kind, "serial");
  const chain = buildChain(db, anchor);
  assert.deepEqual(chain.levels.map((l) => l.status), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(chain.anchor.instance.code, "TBM-2026-001");
  assert.equal(chain.chain.serials.length, 1);
  assert.equal(chain.chain.lots[0].lot_no, "LOT-2026-001");
  assert.equal(chain.evidence_count.inspections, 1);
  assert.equal(chain.evidence_count.welds, 1);
  assert.equal(chain.evidence_count.ndt, 1);
  assert.equal(chain.evidence_count.documents, 1);
  assert.deepEqual(chain.gaps, []);
  db.close();
});

test("TC.3 从装备编码查询：缺序列号时 L4/L5 降级并给出断点建议", () => {
  const db = freshDb();
  ensureChainSchema(db);
  db.prepare("DELETE FROM serial_numbers").run();
  db.prepare("DELETE FROM serial_movements").run();
  const anchor = resolveAnchor(queries(db), { query: { instance_code: "TBM-2026-001" } });
  const chain = buildChain(db, anchor);
  assert.equal(chain.levels[0].status, "ok");
  assert.equal(chain.levels[1].status, "ok");
  assert.equal(chain.levels[3].status, "ok", "批次/领料仍在 → 第 4 级仍可追溯（缺的是序列号粒度）");
  assert.equal(chain.levels[4].status, "ok", "检验/焊缝等证据仍在");
  const issues = chain.gaps.map((g) => g.issue).join(" | ");
  assert.match(issues, /没有序列号记录/);
  assert.match(issues, /BOM 行未关联实装批次/);
  db.close();
});

test("TC.4 从批次号查询：经领料记录反查到装备与工单", () => {
  const db = freshDb();
  ensureChainSchema(db);
  const anchor = resolveAnchor(queries(db), { query: { lot_no: "LOT-2026-001" } });
  assert.equal(anchor.found, true);
  assert.equal(anchor.kind, "lot");
  const chain = buildChain(db, anchor);
  assert.equal(chain.anchor.instance.code, "TBM-2026-001");
  assert.ok(chain.levels[1].count >= 1, "应能反查到工单");
  db.close();
});

test("TC.5 从工单号查询：L1/L2 定位正确", () => {
  const db = freshDb();
  ensureChainSchema(db);
  const anchor = resolveAnchor(queries(db), { query: { wo_code: "WO-001" } });
  assert.equal(anchor.kind, "work_order");
  const chain = buildChain(db, anchor);
  assert.equal(chain.anchor.instance.code, "TBM-2026-001");
  assert.equal(chain.chain.work_orders[0].code, "WO-001");
  assert.equal(chain.chain.operations.length, 2);
  db.close();
});

test("TC.6 未找到锚点：返回 found=false 且带原因", () => {
  const db = freshDb();
  const q = queries(db);
  assert.deepEqual({ found: resolveAnchor(q, { query: { serial_no: "NOPE" } }).found }, { found: false });
  assert.equal(resolveAnchor(q, { query: { serial_no: "NOPE" } }).reason, "serial_not_found");
  assert.equal(resolveAnchor(q, { query: { instance_code: "NOPE" } }).reason, "instance_not_found");
  assert.equal(resolveAnchor(q, { query: { wo_code: "NOPE" } }).reason, "work_order_not_found");
  assert.throws(() => resolveAnchor(q, { query: {} }), /至少提供一个/);
  db.close();
});

test("TC.7 coverage 端点：每级填充率按装备统计", () => {
  const db = freshDb();
  ensureChainSchema(db);
  const routes = new Map();
  const app = { get: (p, h) => routes.set(p, h) };
  registerChainRoutes(app, db);
  const handler = routes.get("/api/trace/chain/coverage");
  assert.ok(handler, "应注册 coverage 路由");
  let captured = null;
  handler({ query: {} }, { json: (x) => { captured = x; } });
  assert.equal(captured.instances, 1);
  const byKey = Object.fromEntries(captured.levels.map((l) => [l.key, l]));
  assert.equal(byKey.instance.pct, 100);
  assert.equal(byKey.work_order.count, 1);
  assert.equal(byKey.qc.count, 1);
  db.close();
});

test("TC.8 chain 端点：按序列号返回完整链路", () => {
  const db = freshDb();
  ensureChainSchema(db);
  db.prepare("UPDATE instance_bom SET material_lot_id = 1 WHERE id = 1").run();
  const routes = new Map();
  const app = { get: (p, h) => routes.set(p, h) };
  registerChainRoutes(app, db);
  const handler = routes.get("/api/trace/chain");
  let captured = null;
  handler({ query: { serial_no: "SN-0001" } }, { json: (x) => { captured = x; } });
  assert.equal(captured.found, true);
  assert.equal(captured.levels.length, 5);
  assert.equal(captured.gaps_count, 0);
  db.close();
});
