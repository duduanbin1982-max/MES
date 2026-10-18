"use strict";
// app/cost/variance.js
// P2-2（2026-10-19）：标准成本 vs 实际成本的三层差异（纯函数，可单测）。
//
// 材料差异（经典标准成本法，两项恒等于总额差）：
//   量差 = (实际用量 − 标准用量) × 标准单价      —— 用多了/用少了
//   价差 = (实际单价 − 标准单价) × 实际用量      —— 买贵了/买便宜了
//   合计 = 实际成本 − 标准成本 = 量差 + 价差
//
// 人工差异：
//   效率差 = (实际工时 − 标准工时) × 标准费率     —— 干慢了/干快了
//   费率差 = (实际费率 − 标准费率) × 实际工时     —— 人工单价变化
//   合计 = 实际人工 − 标准人工 = 效率差 + 费率差
//
// 符号约定：正数 = 超支（不利差异），负数 = 节约（有利差异）。

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function materialVariance({ standardQty = 0, actualQty = 0, standardPrice = 0, actualPrice = 0 } = {}) {
  const sq = num(standardQty);
  const aq = num(actualQty);
  const sp = num(standardPrice);
  const ap = num(actualPrice);
  const quantityVariance = round2((aq - sq) * sp);
  const priceVariance = round2((ap - sp) * aq);
  const standardCost = round2(sq * sp);
  const actualCost = round2(aq * ap);
  return {
    standard_qty: sq,
    actual_qty: aq,
    standard_price: round2(sp),
    actual_price: round2(ap),
    standard_cost: standardCost,
    actual_cost: actualCost,
    quantity_variance: quantityVariance,
    price_variance: priceVariance,
    total_variance: round2(actualCost - standardCost),
    // 恒等式自检：三项必须闭合（超支为正）
    reconciled: round2(quantityVariance + priceVariance) === round2(actualCost - standardCost),
  };
}

function laborVariance({ standardHours = 0, actualHours = 0, standardRate = 0, actualRate = null } = {}) {
  const sh = num(standardHours);
  const ah = num(actualHours);
  const sr = num(standardRate);
  const ar = actualRate === null || actualRate === undefined ? sr : num(actualRate);
  const efficiencyVariance = round2((ah - sh) * sr);
  const rateVariance = round2((ar - sr) * ah);
  const standardCost = round2(sh * sr);
  const actualCost = round2(ah * ar);
  return {
    standard_hours: sh,
    actual_hours: ah,
    standard_rate: round2(sr),
    actual_rate: round2(ar),
    standard_cost: standardCost,
    actual_cost: actualCost,
    efficiency_variance: efficiencyVariance,
    rate_variance: rateVariance,
    total_variance: round2(actualCost - standardCost),
    reconciled: round2(efficiencyVariance + rateVariance) === round2(actualCost - standardCost),
  };
}

/** 汇总：材料 + 人工 → 四个差异项 + 合计 + Top 贡献项 */
function summarize({ materialLines = [], labor = null } = {}) {
  // 2026-10-19：只汇总"数据可用"的项。未领料/未报工的项不能当节约，单独放到 not_computed。
  const totals = { quantity: 0, price: 0, efficiency: 0, rate: 0, standard: 0, actual: 0 };
  const contributors = [];
  const notComputed = { quantity: [], price: [], labor: [] };
  for (const line of materialLines) {
    if (line.available === false) {
      // 未领料：量差不可算，把标准金额单列，避免被当成"节约"
      notComputed.quantity.push({
        key: line.material_code || "",
        name: line.material_name || line.material_code || "",
        standard_qty: line.standard_qty,
        standard_cost: line.standard_cost,
        reason: line.unavailable_reason || "no_issue_record",
      });
      continue;
    }
    totals.quantity += line.quantity_variance || 0;
    totals.price += line.price_variance || 0;
    totals.standard += line.standard_cost || 0;
    totals.actual += line.actual_cost || 0;
    contributors.push({
      kind: "material", key: line.material_code || line.key || "",
      name: line.material_name || line.material_code || "",
      quantity_variance: line.quantity_variance || 0,
      price_variance: line.price_variance || 0,
      total_variance: line.total_variance || 0,
    });
  }
  if (labor && labor.available === false) {
    notComputed.labor.push({ reason: labor.unavailable_reason || "no_actual_hours", standard_hours: labor.standard_hours, standard_cost: labor.standard_cost });
  } else if (labor) {
    totals.efficiency += labor.efficiency_variance || 0;
    totals.rate += labor.rate_variance || 0;
    totals.standard += labor.standard_cost || 0;
    totals.actual += labor.actual_cost || 0;
    contributors.push({
      kind: "labor", key: "labor", name: "人工工时",
      efficiency_variance: labor.efficiency_variance || 0,
      rate_variance: labor.rate_variance || 0,
      total_variance: labor.total_variance || 0,
    });
  }
  const rounded = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)]));
  const totalVariance = round2(rounded.actual - rounded.standard);
  return {
    totals: {
      standard_cost: rounded.standard,
      actual_cost: rounded.actual,
      quantity_variance: rounded.quantity,
      price_variance: rounded.price,
      efficiency_variance: rounded.efficiency,
      rate_variance: rounded.rate,
      total_variance: totalVariance,
      // 三层（业务口径）：材料量差 / 材料价差 / 人工效率差（费率差单列）
      three_layer: {
        quantity: rounded.quantity,
        price: rounded.price,
        efficiency: rounded.efficiency,
        rate: rounded.rate,
      },
      overspend: totalVariance > 0,
      variance_pct: rounded.standard > 0 ? round2((totalVariance / rounded.standard) * 100) : null,
      // 自检：四个分项之和应等于总额差
      reconciled: round2(rounded.quantity + rounded.price + rounded.efficiency + rounded.rate) === totalVariance,
      // 数据完整性：有不可用项时 confidence=partial，前端要显式提示
      confidence: notComputed.quantity.length || notComputed.labor.length ? "partial" : "full",
    },
    not_computed: notComputed,
    top_contributors: contributors
      .filter((item) => Math.abs(item.total_variance) > 0.004)
      .sort((a, b) => Math.abs(b.total_variance) - Math.abs(a.total_variance))
      .slice(0, 3),
  };
}

/**
 * 报工覆盖率是否足够支撑"效率差"。
 * 场景：标准工时 946h，但只报了 2.5h → 效率差 -188700 元，纯属"没报工"而不是"干得快"。
 * 规则：实际工时 / 标准工时 < minPct%（默认 10%）= 覆盖不足，效率差不可用。
 */
function laborCoverageOk({ standardHours = 0, actualHours = 0, minPct = 10 } = {}) {
  const sh = num(standardHours);
  const ah = num(actualHours);
  if (ah <= 0) return { ok: false, coverage_pct: 0, min_pct: minPct, reason: "no_actual_hours" };
  if (sh <= 0) return { ok: true, coverage_pct: null, min_pct: minPct, reason: null };
  const coverage = round2((ah / sh) * 100);
  if (coverage < minPct) return { ok: false, coverage_pct: coverage, min_pct: minPct, reason: "insufficient_actual_hours" };
  return { ok: true, coverage_pct: coverage, min_pct: minPct, reason: null };
}

/** 人工费率解析：system_settings → 环境变量 → 默认 200 元/小时 */
function pickLaborRate({ settingValue = null, envValue = null, fallback = 200 } = {}) {
  for (const candidate of [settingValue, envValue]) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return { rate: n, source: candidate === settingValue ? "system_settings" : "env" };
  }
  return { rate: fallback, source: "default" };
}

module.exports = { round2, num, materialVariance, laborVariance, summarize, pickLaborRate, laborCoverageOk };
