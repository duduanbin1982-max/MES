"use strict";
// services/material/inventory.js 的路由组 6

module.exports = function registerRoutes6(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const { get, requirePermission, run } = ctx;

  app.post('/api/material_units', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const { material_id, from_unit, to_unit, factor, notes } = req.body || {};
    if (!material_id || !from_unit || !to_unit || !factor) throw ApiError.validation('material_id/from_unit/to_unit/factor 必填');
    if (from_unit === to_unit) throw ApiError.validation('from_unit 和 to_unit 不能相同');
    const mat = get('SELECT id, unit FROM materials WHERE id = ?', material_id);
    if (!mat) throw ApiError.notFound('物料不存在');
    try {
      run('INSERT INTO material_units (material_id, from_unit, to_unit, factor, notes) VALUES (?, ?, ?, ?, ?)', [material_id, from_unit, to_unit, factor, notes || null]);
      res.json({ ok: true, id: db.lastInsertRowid, message: '已添加换算 ' + from_unit + ' -> ' + to_unit + ' (×' + factor + ')' });
    } catch (e) { throw e; }
  }));

  app.delete('/api/material_units/:id', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const r = run('DELETE FROM material_units WHERE id = ?', req.params.id);
    res.json({ ok: true, changes: r.changes });
  }));
};
