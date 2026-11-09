"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/keyComponentPrices/priceDiff.js
// 2 端点 (全部件价差):
//   GET /api/key_components/price_diff        列表 (走 v_key_component_price_diff)
//   GET /api/key_components/price_diff/summary 汇总 (按 cost_status 聚合)
// Author: 三狗子 | Date: 2026-06-24

const { KEY_COMPONENT_PRICE_MULTIPLIER, KEY_COMPONENT_PRICE_UNIT } = require("../units");
function register(app, db) {
  const all = (sql) => db.prepare(sql).all();
  const PRICE_DIFF_SQL = `
    SELECT kc.id AS key_component_id, kc.component_type, kc.supplier, kc.supplier_part_no,
           kc.lead_time_weeks, kc.unit_price AS estimated_price,
           m.material_name, m.material_code,
           kcp.actual_price, kcp.id AS current_price_id, kcp.contract_no,
           kcp.valid_from AS price_valid_from, kcp.priced_at,
           ROUND(COALESCE(kcp.actual_price, 0) - COALESCE(kc.unit_price, 0), 4) AS price_diff,
           CASE
             WHEN kcp.actual_price IS NULL THEN 'no_contract_yet'
             WHEN kcp.actual_price <= kc.unit_price THEN 'on_or_under_budget'
             WHEN kcp.actual_price <= kc.unit_price * 1.1 THEN 'over_10pct'
             WHEN kcp.actual_price <= kc.unit_price * 1.2 THEN 'over_20pct'
             ELSE 'over_20pct'
           END AS cost_status
      FROM key_components kc
      LEFT JOIN materials m ON m.id = kc.material_id
      LEFT JOIN key_component_prices kcp ON kcp.id = (
        SELECT p.id FROM key_component_prices p
         WHERE p.key_component_id = kc.id
           AND p.valid_from <= date('now')
           AND (p.valid_to IS NULL OR p.valid_to >= date('now'))
         ORDER BY p.valid_from DESC, p.id DESC LIMIT 1
      )
     ORDER BY kc.lead_time_weeks DESC, kc.id
  `;
  const MULT = KEY_COMPONENT_PRICE_MULTIPLIER;
  

  // 全部件价差列表
  app.get("/api/key_components/price_diff", wrap((req, res) => {
    const rows = all(PRICE_DIFF_SQL).map((row) => ({
      ...row,
      price_unit: KEY_COMPONENT_PRICE_UNIT,
      estimated_price_yuan: Math.round(Number(row.estimated_price || 0) * MULT * 100) / 100,
      actual_price_yuan: row.actual_price == null ? null : Math.round(Number(row.actual_price) * MULT * 100) / 100,
      price_diff_yuan: Math.round(Number(row.price_diff || 0) * MULT * 100) / 100,
    }));
    res.json({ count: rows.length, items: rows, price_unit: "wan" });
  }));

  // 价差汇总
  app.get("/api/key_components/price_diff/summary", wrap((req, res) => {
    const rows = all(PRICE_DIFF_SQL);
    let totalEstimated = 0;
    let totalActual = 0;
    let pendingCount = 0;
    let onBudgetCount = 0;
    let over10Count = 0;
    let over20Count = 0;
    let overTotalDiff = 0;
    let underSavedDiff = 0;
    for (const r of rows) {
      if (r.estimated_price) totalEstimated += r.estimated_price;
      if (r.actual_price) totalActual += r.actual_price;
      if (!r.actual_price) pendingCount++;
      else if (r.cost_status === "on_or_under_budget") {
        onBudgetCount++;
        if (r.price_diff < 0) underSavedDiff += -r.price_diff;
      } else if (r.cost_status === "over_10pct") {
        over10Count++;
        overTotalDiff += r.price_diff;
      } else {
        over20Count++;
        overTotalDiff += r.price_diff;
      }
    }
    res.json({
      component_count: rows.length,
      contract_signed_count: rows.length - pendingCount,
      pending_count: pendingCount,
      on_or_under_budget_count: onBudgetCount,
      over_10pct_count: over10Count,
      over_20pct_count: over20Count,
      price_unit: KEY_COMPONENT_PRICE_UNIT,
      currency: "CNY",
      total_estimated_price: Math.round(totalEstimated * MULT * 100) / 100,
      total_actual_price: Math.round(totalActual * MULT * 100) / 100,
      total_diff: Math.round((totalActual - totalEstimated) * MULT * 100) / 100,
      over_budget_diff: Math.round(overTotalDiff * MULT * 100) / 100,
      under_budget_saved: Math.round(underSavedDiff * MULT * 100) / 100,
    });
  }));
}

module.exports = { register };