"use strict";
// services/material/inventory.js 的路由组 3

module.exports = function registerRoutes3(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const { all, get } = ctx;

  app.get('/api/work_orders/:id/lots', wrap((req, res) => {
    const woId = req.params.id;
    const wo = get('SELECT id, wo_code FROM work_orders WHERE id = ?', woId);
    if (!wo) throw ApiError.notFound('工单不存在');
    const rows = all(`SELECT ml.id as lot_id, ml.lot_no, m.material_code, m.material_name, m.spec,
                             mm.movement_type, mm.quantity, mm.unit, mm.from_location, mm.to_location,
                             mm.created_at, mm.notes
                      FROM material_movements mm
                      JOIN material_lots ml ON mm.material_lot_id = ml.id
                      JOIN materials m ON ml.material_id = m.id
                      WHERE mm.work_order_id = ?
                      ORDER BY mm.created_at`, woId);
    const summary = {};
    rows.forEach(r => { summary[r.lot_no] = (summary[r.lot_no] || 0) + r.quantity; });
    res.json({ work_order: wo, movements: rows, lot_summary: summary });
  }));
};
