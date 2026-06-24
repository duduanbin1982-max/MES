"use strict";
// services/cost/keyComponentPrices/priceDiff.js
// 2 端点 (全部件价差):
//   GET /api/key_components/price_diff        列表 (走 v_key_component_price_diff)
//   GET /api/key_components/price_diff/summary 汇总 (按 cost_status 聚合)
// Author: 三狗子 | Date: 2026-06-24

function register(app, db) {
  const all = (sql) => db.prepare(sql).all();
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };

  // 全部件价差列表
  app.get("/api/key_components/price_diff", wrap((req, res) => {
    const rows = all(
      "SELECT * FROM v_key_component_price_diff ORDER BY lead_time_weeks DESC, key_component_id"
    );
    res.json({ count: rows.length, items: rows });
  }));

  // 价差汇总
  app.get("/api/key_components/price_diff/summary", wrap((req, res) => {
    const rows = all("SELECT * FROM v_key_component_price_diff");
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
      total_estimated_price: Math.round(totalEstimated * 100) / 100,
      total_actual_price: Math.round(totalActual * 100) / 100,
      total_diff: Math.round((totalActual - totalEstimated) * 100) / 100,
      over_budget_diff: Math.round(overTotalDiff * 100) / 100,
      under_budget_saved: Math.round(underSavedDiff * 100) / 100,
    });
  }));
}

module.exports = { register };