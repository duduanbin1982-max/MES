"use strict";
// services/material/inventory.js 的路由组 4

module.exports = function registerRoutes4(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require('../../../app/errors');
const { all } = ctx;

  app.get('/api/inventory/stagnant', wrap((req, res) => {
    // 2026-11-07: days 限幅, 原实现 days=-5 会返回全量数据
    const rawDays = req.query.days;
    let days = 90;
    if (rawDays !== undefined && rawDays !== '') {
      days = Number(rawDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw ApiError.validation('days 必须是 1..3650 的整数');
    }
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             ml.supplier, ml.received_date,
                             i.quantity, i.unit, i.location, i.status, i.last_updated,
                             (julianday('now') - julianday(COALESCE(MAX(mm.created_at), ml.received_date))) as idle_days
                      FROM material_lots ml
                      JOIN materials m ON ml.material_id = m.id
                      LEFT JOIN inventory i ON i.material_lot_id = ml.id
                      LEFT JOIN material_movements mm ON mm.material_lot_id = ml.id
                      WHERE (i.status IS NULL OR i.status IN ('available', 'allocated'))
                        AND (i.quantity IS NULL OR i.quantity > 0)
                      GROUP BY ml.id
                      HAVING idle_days >= ?
                      ORDER BY idle_days DESC`, days);
    res.json({ count: rows.length, days, items: rows });
  }));
};
