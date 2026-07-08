"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/materialPrices/pricesSummary.js
// 1 端点:
//   GET /api/materials/prices/summary   覆盖率: 总数 / 估价已填 / 实际已填 / 总估价
// Author: 三狗子 | Date: 2026-06-24

function register(app, db) {
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  

  app.get("/api/materials/prices/summary", wrap((req, res) => {
    const total = get("SELECT COUNT(*) AS c FROM materials").c;
    const est_filled = get("SELECT COUNT(*) AS c FROM materials WHERE estimated_unit_price > 0").c;
    const act_filled = get("SELECT COUNT(*) AS c FROM materials WHERE actual_unit_price > 0").c;
    const tot_est = get("SELECT COALESCE(SUM(estimated_unit_price), 0) AS s FROM materials").s;
    const tot_act = get("SELECT COALESCE(SUM(actual_unit_price), 0) AS s FROM materials").s;
    const in_bom = get(`SELECT COUNT(DISTINCT material_id) AS c FROM instance_bom`).c;
    const in_bom_est_filled = get(`
      SELECT COUNT(DISTINCT ib.material_id) AS c
        FROM instance_bom ib JOIN materials m ON m.id = ib.material_id
       WHERE m.estimated_unit_price > 0
    `).c;
    res.json({
      materials_total: total,
      estimated_filled: est_filled,
      actual_filled: act_filled,
      estimated_coverage_pct: total ? Math.round(est_filled * 10000 / total) / 100 : 0,
      actual_coverage_pct:    total ? Math.round(act_filled * 10000 / total) / 100 : 0,
      total_estimated_unit_price_sum: Number(tot_est.toFixed(2)),
      total_actual_unit_price_sum:    Number(tot_act.toFixed(2)),
      used_in_bom_count: in_bom,
      used_in_bom_estimated_filled: in_bom_est_filled,
      used_in_bom_coverage_pct: in_bom ? Math.round(in_bom_est_filled * 10000 / in_bom) / 100 : 0
    });
  }));
}

module.exports = { register };