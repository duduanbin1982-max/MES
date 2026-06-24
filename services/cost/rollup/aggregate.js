"use strict";
// services/cost/rollup/aggregate.js
// 纯函数: 把 SQL 原始 rows 聚合成 cost rollup 响应
//   aggregateKeyComponents(keys): 关键件行的价差 + cost_status
//   aggregateMaterials(mats):     普通物料行的 total
//   contractYuan / contractMargin / contractMarginPct: 合同金额换算 (wan/yuan)
// Author: 三狗子 | Date: 2026-06-24

const { round2 } = require("./queries");

/**
 * 聚合关键件行:
 *   输入 keys: [{ key_component_id, material_code, ..., estimated_unit_price, actual_unit_price, ... }]
 *   输出 { rows: [...], estimated_total, actual_total, signed, pending, over_budget }
 *
 * cost_status 规则:
 *   - has_contract = false           -> "no_contract_yet"
 *   - actual <= estimated            -> "on_or_under_budget"
 *   - actual > estimated * 1.2       -> "over_20pct"
 *   - else                            -> "over_10pct"
 */
function aggregateKeyComponents(keys) {
  let estimated_total = 0, actual_total = 0, signed = 0, pending = 0, over_budget = 0;
  const rows = keys.map((k) => {
    const q = Number(k.quantity || 0);
    const est_unit = Number(k.estimated_unit_price || 0);
    const has_contract = k.actual_unit_price != null;
    const act_unit = has_contract ? Number(k.actual_unit_price) : est_unit;
    const est_total = round2(est_unit * q);
    const act_total = round2(act_unit * q);
    const diff = round2(act_total - est_total);
    estimated_total += est_total;
    actual_total    += act_total;
    if (has_contract) signed++; else pending++;
    if (has_contract && k.actual_unit_price > k.estimated_unit_price) over_budget++;

    let cost_status;
    if (!has_contract) cost_status = "no_contract_yet";
    else if (k.actual_unit_price <= k.estimated_unit_price) cost_status = "on_or_under_budget";
    else if (k.actual_unit_price > k.estimated_unit_price * 1.2) cost_status = "over_20pct";
    else cost_status = "over_10pct";

    return {
      key_component_id: k.key_component_id,
      material_code: k.material_code,
      material_name: k.material_name,
      component_type: k.component_type,
      supplier: k.supplier,
      quantity: q,
      estimated_unit_price: est_unit,
      actual_unit_price: has_contract ? Number(k.actual_unit_price) : null,
      estimated_total: est_total,
      actual_total: act_total,
      price_diff: diff,
      contract_no: k.contract_no,
      currency: k.currency || "CNY",
      cost_status,
    };
  });
  return {
    rows,
    estimated_total: round2(estimated_total),
    actual_total: round2(actual_total),
    signed,
    pending,
    over_budget,
  };
}

/**
 * 聚合普通物料行 (只有估价, 实际价=估价, 视同未签合同)
 *   返回 { rows, estimated_total, actual_total (== estimated_total) }
 */
function aggregateMaterials(mats) {
  let estimated_total = 0;
  const rows = mats.map((m) => {
    const q = Number(m.quantity || 0);
    const unit = Number(m.estimated_unit_price || 0);
    const est_total = round2(unit * q);
    estimated_total += est_total;
    return {
      material_id: m.material_id,
      material_code: m.material_code,
      material_name: m.material_name,
      material_type: m.material_type,
      unit: m.unit,
      quantity: q,
      unit_price: unit,
      estimated_total: est_total,
      actual_total: est_total,
    };
  });
  estimated_total = round2(estimated_total);
  return { rows, estimated_total, actual_total: estimated_total };
}

/**
 * 合同金额换算 (wan -> 元, yuan -> 元)
 * 返回 { yuan, margin, margin_pct } 或所有字段 null (无合同金额)
 */
function deriveContractMetrics(inst, totalActual) {
  const a = inst.contract_amount;
  if (a == null) return { yuan: null, margin: null, margin_pct: null };
  const u = inst.contract_amount_unit || "wan";
  const yuan = round2(Number(a) * (u === "wan" ? 10000 : 1));
  const margin = round2(yuan - totalActual);
  const margin_pct = yuan <= 0 ? null : round2((yuan - totalActual) / yuan * 100);
  return { yuan, margin, margin_pct };
}

module.exports = {
  aggregateKeyComponents,
  aggregateMaterials,
  deriveContractMetrics,
};