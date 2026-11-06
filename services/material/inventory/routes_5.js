"use strict";
// services/material/inventory.js 的路由组 5

module.exports = function registerRoutes5(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require('../../../app/errors');
const { all, get } = ctx;

  app.get('/api/materials/:id/units', wrap((req, res) => {
    const matId = Number(req.params.id);
    if (!Number.isInteger(matId) || matId <= 0) throw ApiError.validation('物料 id 必须是正整数');
    const material = get('SELECT id, unit FROM materials WHERE id = ?', matId);
    if (!material) throw ApiError.notFound('物料不存在');
    const rows = all('SELECT * FROM material_units WHERE material_id = ? ORDER BY from_unit', matId);
    res.json({ count: rows.length, base_unit: material.unit || null, items: rows });
  }));
};
