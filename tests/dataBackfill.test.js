"use strict";
// tests/dataBackfill.test.js
// P0-B（2026-10-18）：数据补录工具 —— CSV 解析、三类计划生成、dry-run/apply/rollback、幂等与校验。

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const backfill = require("../scripts/data-backfill");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE equipment_instances (id INTEGER PRIMARY KEY, instance_code TEXT);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, material_code TEXT, material_name TEXT);
    CREATE TABLE material_lots (id INTEGER PRIMARY KEY, material_id INTEGER, lot_no TEXT);
    CREATE TABLE instance_bom (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, part_number TEXT, material_id INTEGER,
                               quantity REAL, is_key_component INTEGER, material_lot_id INTEGER, serial_id INTEGER);
    CREATE TABLE serial_numbers (id INTEGER PRIMARY KEY, serial_no TEXT UNIQUE, lot_id INTEGER, equipment_instance_id INTEGER,
                                 status TEXT, work_order_id INTEGER);
    CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_code TEXT);
    CREATE TABLE oee_shift_log (id INTEGER PRIMARY KEY, equipment_instance_id INTEGER, shift_date TEXT, shift_name TEXT,
                                planned_minutes REAL, operating_minutes REAL, ideal_cycle_time REAL, total_output INTEGER,
                                good_output INTEGER, shift_minutes REAL, planned_stop_minutes REAL, fault_minutes REAL,
                                changeover_minutes REAL, material_wait_minutes REAL, idle_minutes REAL);
    INSERT INTO equipment_instances VALUES (1, 'TBM-2026-001');
    INSERT INTO materials VALUES (1, 'M-001', 'Q355 钢板');
    INSERT INTO material_lots VALUES (1, 1, 'LOT-2026-001');
    INSERT INTO instance_bom VALUES (1, 1, 'P-001', 1, 10, 1, NULL, NULL);
    INSERT INTO work_orders VALUES (1, 'WO-001');
    INSERT INTO oee_shift_log VALUES (1, 1, '2026-06-01', '白班', 450, 360, 2, 150, 145, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  return db;
}

test("BF.1 parseCsv：引号/逗号/CRLF/BOM 头", () => {
  const rows = backfill.parseCsv('\uFEFFa,b\r\n"x,1","he said ""hi"""\r\n');
  assert.deepEqual(rows, [{ a: "x,1", b: 'he said "hi"' }]);
});

test("BF.2 planBomLots：正常计划 + 缺批次/零件不存在报错", () => {
  const db = freshDb();
  const plan = backfill.planBomLots(db, [
    { instance_code: "TBM-2026-001", part_number: "P-001", lot_no: "LOT-2026-001" },
    { instance_code: "TBM-2026-001", part_number: "P-404", lot_no: "LOT-2026-001" },
    { instance_code: "TBM-2026-001", part_number: "P-001" },
  ]);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0], { table: "instance_bom", rowId: 1, column: "material_lot_id", oldValue: null, newValue: 1, key: "TBM-2026-001/P-001" });
  assert.equal(plan.errors.length, 2);
  db.close();
});

test("BF.3 planBomLots：物料不一致默认报错，开关后可放行", () => {
  const db = freshDb();
  db.exec("INSERT INTO materials VALUES (2,'M-002','别的料'); INSERT INTO material_lots VALUES (2, 2, 'LOT-WRONG');");
  const strict = backfill.planBomLots(db, [{ instance_code: "TBM-2026-001", part_number: "P-001", lot_no: "LOT-WRONG" }]);
  assert.equal(strict.changes.length, 0);
  assert.match(strict.errors[0].reason, /不一致/);
  const relaxed = backfill.planBomLots(db, [{ instance_code: "TBM-2026-001", part_number: "P-001", lot_no: "LOT-WRONG" }], { allowMaterialMismatch: true });
  assert.equal(relaxed.changes.length, 1);
  db.close();
});

test("BF.4 planSerials：新建 + 已存在跳过 + 缺批次报错", () => {
  const db = freshDb();
  const plan = backfill.planSerials(db, [
    { serial_no: "SN-1", lot_no: "LOT-2026-001", instance_code: "TBM-2026-001" },
    { serial_no: "SN-1", lot_no: "LOT-2026-001" },
    { serial_no: "SN-2", lot_no: "LOT-NOPE" },
  ]);
  assert.equal(plan.inserts.length, 1, "CSV 内重复的序列号只插一次");
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /CSV 内重复/);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].reason, /批次号不存在/);
  db.close();
});

test("BF.5 planOeeShifts：只填有变化的列，跳过无变化", () => {
  const db = freshDb();
  const plan = backfill.planOeeShifts(db, [
    { shift_id: 1, shift_minutes: 450, fault_minutes: 60, changeover_minutes: 20, material_wait_minutes: 10 },
    { shift_id: 1, shift_minutes: 450, fault_minutes: 0, changeover_minutes: 0, material_wait_minutes: 0, idle_minutes: null },
  ]);
  assert.ok(plan.changes.length >= 3);
  assert.ok(plan.changes.some((c) => c.column === "fault_minutes" && c.newValue === 60));
  db.close();
});

test("BF.6 applyPlan + rollbackBatch：写入并完整还原（含 INSERT 撤销）", () => {
  const db = freshDb();
  const plan = backfill.planBomLots(db, [{ instance_code: "TBM-2026-001", part_number: "P-001", lot_no: "LOT-2026-001" }]);
  const serialPlan = backfill.planSerials(db, [{ serial_no: "SN-9", lot_no: "LOT-2026-001" }]);
  const applied1 = backfill.applyPlan(db, plan);
  const applied2 = backfill.applyPlan(db, serialPlan);
  assert.equal(db.prepare("SELECT material_lot_id FROM instance_bom WHERE id=1").get().material_lot_id, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM serial_numbers").get().c, 1);

  const rb1 = backfill.rollbackBatch(db, applied1.batchFile);
  assert.equal(rb1.reverted, 1);
  assert.equal(db.prepare("SELECT material_lot_id FROM instance_bom WHERE id=1").get().material_lot_id, null);

  const rb2 = backfill.rollbackBatch(db, applied2.batchFile);
  assert.equal(rb2.reverted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM serial_numbers").get().c, 0);

  // 重复回滚是幂等的
  assert.equal(backfill.rollbackBatch(db, applied2.batchFile).already, true);
  db.close();
});

test("BF.8 planLots：批次批量登记（重复跳过 / 物料不存在报错 / 日期校验）", () => {
  const db = freshDb();
  const plan = backfill.planLots(db, [
    { material_code: "M-001", lot_no: "LOT-NEW-1", supplier: "宝钢", received_date: "2026-10-01", quantity: "12.5", unit: "t" },
    { material_code: "M-001", lot_no: "LOT-NEW-1" },
    { material_code: "M-404", lot_no: "LOT-X" },
    { material_code: "M-001", lot_no: "LOT-BAD-DATE", received_date: "2026/13/01" },
  ]);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].values.lot_no, "LOT-NEW-1");
  assert.equal(plan.inserts[0].values.quantity, 12.5);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /CSV 内重复批次/);
  assert.equal(plan.errors.length, 2);
  assert.ok(plan.errors.some((e) => /物料编码不存在/.test(e.reason)));
  assert.ok(plan.errors.some((e) => /received_date/.test(e.reason)));
  db.close();
});

test("BF.9 completenessReport：算出还差多少才能补 BOM 批次", () => {
  const db = freshDb();
  const report = backfill.completenessReport(db);
  assert.equal(report.materials.total, 1);
  assert.equal(report.lots.total, 1);
  assert.equal(report.materials.with_lot, 1);
  assert.equal(report.bom.total, 1);
  assert.equal(report.bom.with_lot, 0);
  assert.equal(report.bom.lot_pct, 0);
  assert.equal(report.oee.shifts, 1);
  assert.equal(report.oee.with_explicit_loss, 0);
  assert.deepEqual(report.materials_without_lot, []);
  db.close();
});

test("BF.13 bom_id 精确定位：同装备同物料多条 BOM 行不再歧义", () => {
  const db = freshDb();
  // 再造一条同物料 BOM 行（模拟 滚刀 12 件 / 1 件 两行）
  db.exec("INSERT INTO instance_bom VALUES (2, 1, 'P-001', 1, 1, 1, NULL, NULL)");
  const ambiguous = backfill.planBomLots(db, [{ instance_code: "TBM-2026-001", material_code: "M-001", lot_no: "LOT-2026-001" }]);
  assert.equal(ambiguous.changes.length, 0);
  assert.match(ambiguous.errors[0].reason, /多条 BOM 行/);

  const precise = backfill.planBomLots(db, [{ bom_id: 2, instance_code: "TBM-2026-001", material_code: "M-001", lot_no: "LOT-2026-001" }]);
  assert.equal(precise.changes.length, 1);
  assert.equal(precise.changes[0].rowId, 2);

  const wrongInstance = backfill.planBomLots(db, [{ bom_id: 2, instance_code: "TBM-2026-001", lot_no: "LOT-2026-001" }]);
  assert.equal(wrongInstance.changes.length, 1, "同装备应通过");
  const badInstance = backfill.planBomLots(db, [{ bom_id: 2, instance_code: "NO-SUCH", lot_no: "LOT-2026-001" }]);
  assert.match(badInstance.errors[0].reason, /装备编码不存在/);
  db.close();
});

test("BF.7 幂等：已填过 material_lot_id 的行默认跳过", () => {
  const db = freshDb();
  db.exec("UPDATE instance_bom SET material_lot_id = 1 WHERE id = 1");
  const plan = backfill.planBomLots(db, [{ instance_code: "TBM-2026-001", part_number: "P-001", lot_no: "LOT-2026-001" }]);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /已有值/);
  db.close();
});

test("BF.10 decodeCsvBuffer：UTF-8 原样解码，GBK 自动回退（Excel 中文环境）", () => {
  const utf8 = Buffer.from("material_code,lot_no\nM-1,批次一\n", "utf8");
  const a = backfill.decodeCsvBuffer(utf8);
  assert.equal(a.encoding, "utf-8");
  assert.match(a.text, /批次一/);

  // "宝钢" 的 GBK 字节：B1 A6 B8 D6
  const gbk = Buffer.from([0x6d, 0x2c, 0xb1, 0xa6, 0xb8, 0xd6, 0x0a]); // "m,宝钢\n"
  const b = backfill.decodeCsvBuffer(gbk);
  assert.equal(b.encoding, "gbk");
  assert.match(b.text, /宝钢/);
});

test("BF.11 normalizeDate：兼容 Excel 的 / 与 . 分隔", () => {
  assert.equal(backfill.normalizeDate("2026-10-15"), "2026-10-15");
  assert.equal(backfill.normalizeDate("2026/10/15"), "2026-10-15");
  assert.equal(backfill.normalizeDate("2026/1/5"), "2026-01-05");
  assert.equal(backfill.normalizeDate("2026.10.15"), "2026-10-15");
  assert.equal(backfill.normalizeDate("2026/13/01"), null);
  assert.equal(backfill.normalizeDate(""), null);
  assert.equal(backfill.normalizeDate("昨天"), null);
});

test("BF.12 planLots：Excel 日期格式可直接通过", () => {
  const db = freshDb();
  const plan = backfill.planLots(db, [
    { material_code: "M-001", lot_no: "LOT-EXCEL-1", received_date: "2026/10/15", quantity: "3" },
    { material_code: "M-001", lot_no: "LOT-EXCEL-2", received_date: "2026/13/01" },
  ]);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].values.received_date, "2026-10-15");
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].reason, /无法识别/);
  db.close();
});
