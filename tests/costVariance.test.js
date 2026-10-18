"use strict";
// tests/costVariance.test.js
// P2-2（2026-10-19）：成本三层差异 —— 恒等式、汇总、Top 贡献项、费率解析。

const test = require("node:test");
const assert = require("node:assert/strict");

const { materialVariance, laborVariance, summarize, pickLaborRate, laborCoverageOk, round2 } = require("../app/cost/variance");

test("CV.1 材料差异：量差 + 价差 = 总额差（恒等式闭合）", () => {
  const v = materialVariance({ standardQty: 100, actualQty: 120, standardPrice: 10, actualPrice: 12 });
  assert.equal(v.quantity_variance, 200);   // (120-100)*10
  assert.equal(v.price_variance, 240);      // (12-10)*120
  assert.equal(v.standard_cost, 1000);
  assert.equal(v.actual_cost, 1440);
  assert.equal(v.total_variance, 440);
  assert.equal(v.quantity_variance + v.price_variance, v.total_variance);
  assert.equal(v.reconciled, true);
});

test("CV.2 材料差异：买便宜 + 用得多 → 价差为负、量差为正", () => {
  const v = materialVariance({ standardQty: 50, actualQty: 60, standardPrice: 20, actualPrice: 18 });
  assert.equal(v.quantity_variance, 200);   // 多用 10 × 20
  assert.equal(v.price_variance, -120);     // 便宜 2 × 60
  assert.equal(v.total_variance, 80);
  assert.equal(v.reconciled, true);
});

test("CV.3 人工差异：效率差 + 费率差 = 总额差", () => {
  const v = laborVariance({ standardHours: 80, actualHours: 100, standardRate: 200 });
  assert.equal(v.efficiency_variance, 4000);  // 多用 20h × 200
  assert.equal(v.rate_variance, 0);           // 费率未变
  assert.equal(v.total_variance, 4000);
  assert.equal(v.reconciled, true);
  const withRate = laborVariance({ standardHours: 10, actualHours: 10, standardRate: 200, actualRate: 250 });
  assert.equal(withRate.efficiency_variance, 0);
  assert.equal(withRate.rate_variance, 500);  // (250-200)*10
  assert.equal(withRate.total_variance, 500);
});

test("CV.4 极端输入：0 / null / 负数 / 非数字都不炸", () => {
  const zero = materialVariance({});
  assert.equal(zero.total_variance, 0);
  assert.equal(zero.reconciled, true);
  const noPrice = materialVariance({ standardQty: 10, actualQty: 10 });
  assert.equal(noPrice.total_variance, 0);
  const junk = laborVariance({ standardHours: "abc", actualHours: null, standardRate: undefined });
  assert.equal(junk.total_variance, 0);
});

test("CV.5 summarize：四项之和 = 总额差，超支标记正确，Top3 按绝对值排序", () => {
  const lines = [
    materialVariance({ standardQty: 100, actualQty: 130, standardPrice: 10, actualPrice: 10 }),  // +300
    materialVariance({ standardQty: 20, actualQty: 20, standardPrice: 50, actualPrice: 45 }),     // -100
    materialVariance({ standardQty: 5, actualQty: 5, standardPrice: 100, actualPrice: 110 }),     // +50
  ];
  lines[0].material_code = "M-A"; lines[1].material_code = "M-B"; lines[2].material_code = "M-C";
  const labor = { efficiency_variance: 1000, rate_variance: 0, standard_cost: 4000, actual_cost: 5000, total_variance: 1000 };
  const s = summarize({ materialLines: lines, labor });
  assert.equal(s.totals.standard_cost, round2(1000 + 1000 + 500 + 4000));
  assert.equal(s.totals.actual_cost, round2(1300 + 900 + 550 + 5000));
  assert.equal(s.totals.total_variance, round2(s.totals.actual_cost - s.totals.standard_cost));
  assert.equal(s.totals.reconciled, true);
  assert.equal(s.totals.overspend, true);
  assert.deepEqual(s.top_contributors.map((c) => c.name), ["人工工时", "M-A", "M-B"]);
});

test("CV.6 pickLaborRate：设置 → 环境变量 → 默认 200", () => {
  assert.deepEqual(pickLaborRate({ settingValue: "260", envValue: "300" }), { rate: 260, source: "system_settings" });
  assert.deepEqual(pickLaborRate({ settingValue: null, envValue: "300" }), { rate: 300, source: "env" });
  assert.deepEqual(pickLaborRate({}), { rate: 200, source: "default" });
  assert.deepEqual(pickLaborRate({ settingValue: "0", envValue: "-5" }), { rate: 200, source: "default" });
  assert.deepEqual(pickLaborRate({ settingValue: "abc" }), { rate: 200, source: "default" });
});

test("CV.7 未领料/未报工：不计入合计，单独放 not_computed（不能当节约）", () => {
  const available = materialVariance({ standardQty: 100, actualQty: 110, standardPrice: 10, actualPrice: 10 });
  available.material_code = "M-OK";
  const notIssued = materialVariance({ standardQty: 500, actualQty: 0, standardPrice: 10, actualPrice: 10 });
  notIssued.material_code = "M-NO-ISSUE";
  notIssued.standard_cost = 5000;
  notIssued.available = false;
  notIssued.unavailable_reason = "no_issue_record";

  const labor = { efficiency_variance: 0, rate_variance: 0, standard_cost: 2000, actual_cost: 2000, total_variance: 0, standard_hours: 10, available: false, unavailable_reason: "no_actual_hours" };
  const s = summarize({ materialLines: [available, notIssued], labor });

  assert.equal(s.totals.quantity_variance, 100, "只算已领料的量差");
  assert.equal(s.totals.confidence, "partial");
  assert.equal(s.not_computed.quantity.length, 1);
  assert.equal(s.not_computed.quantity[0].standard_cost, 5000);
  assert.equal(s.not_computed.labor.length, 1);
  // 合计只含可用项：数量差 100（材料），人工未计入
  assert.equal(s.totals.total_variance, 100);
  assert.equal(s.totals.reconciled, true);
});

test("CV.8 laborCoverageOk：报工覆盖不足时不给效率差（防假节约/假超支）", () => {
  assert.equal(laborCoverageOk({ standardHours: 946, actualHours: 2.5 }).ok, false);
  assert.equal(laborCoverageOk({ standardHours: 946, actualHours: 2.5 }).reason, "insufficient_actual_hours");
  assert.equal(laborCoverageOk({ standardHours: 100, actualHours: 0 }).reason, "no_actual_hours");
  assert.equal(laborCoverageOk({ standardHours: 100, actualHours: 10 }).ok, true, "刚好 10% 算可用");
  assert.equal(laborCoverageOk({ standardHours: 100, actualHours: 9.9 }).ok, false);
  assert.equal(laborCoverageOk({ standardHours: 100, actualHours: 20, minPct: 30 }).ok, false, "阈值可配");
  assert.equal(laborCoverageOk({ standardHours: 0, actualHours: 5 }).ok, true, "无标准工时时不阻塞");
});
