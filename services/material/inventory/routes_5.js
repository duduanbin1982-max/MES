"use strict";
// services/material/inventory.js 的路由组 5

module.exports = function registerRoutes5(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { all } = ctx;

  app.get('/api/materials/:id/units', wrap((req, res) => {
    const matId = req.params.id;
    const rows = all('SELECT * FROM material_units WHERE material_id = ? ORDER BY from_unit', matId);
    res.json({ count: rows.length, items: rows });
  }));
};
