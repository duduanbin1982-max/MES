"use strict";
// tests/oeeIsa95.test.js
// P0-1（2026-10-18）：OEE 的 ISA-95 口径 —— 三层时间基线、六大损失归类、口径一致性校验。

const test = require("node:test");
const assert = require("node:assert/strict");

const isa95 = require("../app/oee/isa95");
const cat = require("../app/oee/lossCatalog");

function shiftRow(over) {
  return {
    id: 1,
    equipment_instance_id: 1,
    shift_date: "2026-10-17",
    shift_name: "白班",
    shift_minutes: 480,
    planned_stop_minutes: 30,
    planned_minutes: 450,
    operating_minutes: 360,
    ideal_cycle_time: 2,
    total_output: 150,
    good_output: 145,
    fault_minutes: 60,
    changeover_minutes: 20,
    material_wait_minutes: 10,
    idle_minutes: 0,
    source: "manual",
    ...over,
  };
}

test("ISA.1 三层时间基线：班次 → 计划生产 → 运行 → 净运行", () => {
  const r = isa95.computeShift(shiftRow(), []);
  assert.equal(r.basis.shift_minutes, 480);
  assert.equal(r.basis.planned_stop_minutes, 30);
  assert.equal(r.basis.planned_production_minutes, 450);
  assert.equal(r.basis.run_minutes, 360);
  assert.equal(r.basis.availability_loss_minutes, 90, "故障 60 + 换型 20 + 待料 10");
  // 理论运行 = 2 分钟/件 × 150 件 = 300
  assert.equal(r.basis.net_run_minutes, 300);
});

test("ISA.2 OEE = 可用率 × 性能 × 质量（ISA-95 定义）", () => {
  const r = isa95.computeShift(shiftRow(), []);
  assert.equal(r.availability, 0.8);          // 360 / 450
  assert.equal(r.performance, 0.8333);        // 300 / 360
  assert.equal(r.quality, 0.9667);            // 145 / 150
  assert.equal(r.oee, 0.6444);                // 0.8 × 0.8333 × 0.9667
  assert.equal(isa95.grade(r.oee), "C");
});

test("ISA.3 口径一致性：损失合计与时间差一致时 ok=true", () => {
  const r = isa95.computeShift(shiftRow(), []);
  assert.equal(r.data_quality.diff_minutes, 0);
  assert.equal(r.data_quality.ok, true);
});

test("ISA.4 口径不一致时 ok=false（差异超过 2%）", () => {
  // 计划生产 450、运行 360 → 应有 90 分钟损失，但只记了 20 分钟故障
  const r = isa95.computeShift(shiftRow({ fault_minutes: 20, changeover_minutes: 0, material_wait_minutes: 0 }), []);
  assert.equal(r.data_quality.ok, false);
  assert.ok(r.data_quality.diff_pct > 2, "差异百分比应大于 2%");
});

test("ISA.5 planned_stop 不计入损失，但计入计划生产时间的推导", () => {
  const r = isa95.computeShift(
    shiftRow({
      planned_minutes: 0, // 未显式给计划生产时间 → 用 班次−计划停机
      planned_stop_minutes: 60,
      shift_minutes: 480,
      operating_minutes: 360,
      fault_minutes: 60,
      changeover_minutes: 0,
      material_wait_minutes: 0,
      ideal_cycle_time: 2,
      total_output: 180,
      good_output: 180,
    }),
    [{ loss_category: "计划停机", duration_minutes: 60 }]
  );
  assert.equal(r.basis.planned_production_minutes, 420);
  assert.equal(r.losses.filter((x) => x.key === "planned_stop").length, 0, "计划停机不进损失列表");
});

test("ISA.6 损失事件归一化：历史中文标签 → 规范 key，未知归 other", () => {
  const r = isa95.computeShift(shiftRow({ fault_minutes: 0, changeover_minutes: 0, material_wait_minutes: 0 }), [
    { loss_category: "故障停机", duration_minutes: 40 },
    { loss_category: "换型", duration_minutes: 20 },
    { loss_category: "待料", duration_minutes: 10 },
    { loss_category: "谁知道什么原因", duration_minutes: 5 },
    { loss_category: "计划停机", duration_minutes: 30 },
  ]);
  const keys = r.losses.map((x) => x.key).sort();
  assert.deepEqual(keys, ["equipment_failure", "idling_waiting", "other", "setup_adjustment"]);
  assert.equal(r.basis.availability_loss_minutes, 75, "40+20+10+5，计划停机不算");
});

test("ISA.7 兼容老数据：没有 shift_minutes / operating_minutes 时退化计算", () => {
  const r = isa95.computeShift(
    {
      planned_minutes: 450,
      fault_minutes: 0,
      changeover_minutes: 0,
      material_wait_minutes: 0,
      ideal_cycle_time: 2.5,
      total_output: 120,
      good_output: 120,
    },
    [{ loss_category: "故障停机", duration_minutes: 90 }]
  );
  assert.equal(r.basis.planned_production_minutes, 450);
  assert.equal(r.basis.shift_minutes, 450, "无班次时长时退化为计划生产时间");
  assert.equal(r.basis.run_minutes, 360, "450 − 90 = 360");
  assert.equal(r.availability, 0.8);
});

test("ISA.8 多班次聚合按分钟累加，不对百分比取平均", () => {
  const a = { shift: shiftRow({ id: 1 }), result: isa95.computeShift(shiftRow(), []) };
  const b = {
    shift: shiftRow({ id: 2, shift_name: "夜班", operating_minutes: 450, fault_minutes: 0, changeover_minutes: 0, material_wait_minutes: 0, total_output: 200, good_output: 200, source: "iot" }),
    result: null,
  };
  b.result = isa95.computeShift(b.shift, []);
  const agg = isa95.aggregateShifts([a, b]);
  // 计划生产 450+450=900；运行 360+450=810；可用率 = 0.9
  assert.equal(agg.basis.planned_production_minutes, 900);
  assert.equal(agg.basis.run_minutes, 810);
  assert.equal(agg.availability, 0.9);
  assert.deepEqual(agg.sources.map((s) => s.source).sort(), ["iot", "manual"]);
});

test("ISA.9 损失目录自身是自洽的（key 唯一 / bucket 合法 / legacy 无冲突）", () => {
  const keys = new Set();
  const legacy = new Set();
  for (const c of cat.catalog.categories) {
    assert.ok(c.key, "缺 key");
    assert.ok(!keys.has(c.key), "key 重复: " + c.key);
    keys.add(c.key);
    assert.ok(["availability", "performance", "quality", "none"].includes(c.bucket), "bucket 非法: " + c.bucket);
    for (const label of c.legacy_labels || []) {
      assert.ok(!legacy.has(label), "legacy label 冲突: " + label);
      legacy.add(label);
    }
  }
  assert.equal(cat.normalizeKey("故障停机"), "equipment_failure");
  assert.equal(cat.normalizeKey("equipment_failure"), "equipment_failure");
  assert.equal(cat.normalizeKey("设备故障（液压系统）"), "equipment_failure");
  assert.equal(cat.normalizeKey("完全不认识"), "other");
  assert.equal(cat.countsAsLoss("planned_stop"), false);
  assert.equal(cat.bucketOf("minor_stops"), "performance");
  assert.equal(cat.bucketOf("quality_defects"), "quality");
});

test("ISA.10 损失归属不可靠时标记 legacy（不制造假阳性）", () => {
  const shift = shiftRow({ fault_minutes: 0, changeover_minutes: 0, material_wait_minutes: 0, idle_minutes: 0 });
  const events = [{ loss_category: "故障停机", duration_minutes: 200 }];
  // 归属可靠：单班次当日 → 200 vs 90 分钟差值 → mismatch
  const reliable = isa95.computeShift(shift, events, { unreliableEvents: false });
  assert.equal(reliable.data_quality.level, "mismatch");
  // 归属不可靠（同一设备同日多班次）→ legacy，不算通过也不算错误
  const ambiguous = isa95.computeShift(shift, events, { unreliableEvents: true });
  assert.equal(ambiguous.data_quality.level, "legacy");
  assert.equal(ambiguous.data_quality.verifiable, false);
  assert.equal(ambiguous.data_quality.reason, "ambiguous_event_attribution");
});

test("ISA.11 缺三层基线时标记 legacy + missing_basis", () => {
  const r = isa95.computeShift(
    { planned_minutes: 0, operating_minutes: 0, total_output: 0, good_output: 0 },
    []
  );
  assert.equal(r.data_quality.level, "legacy");
  assert.equal(r.data_quality.reason, "missing_basis");
});
