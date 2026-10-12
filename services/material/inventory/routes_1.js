"use strict";
// services/material/inventory.js 的路由组 1

module.exports = function registerRoutes1(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const { _applyMovement, all, get, requireLogin, requirePermission } = ctx;

  app.get('/api/material_movements', wrap((req, res) => {
    if (requireLogin(req, res)) return;
    const { material_lot_id, work_order_id, project_id, movement_type, date_from, date_to, limit, offset } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
    const off = Math.max(parseInt(offset) || 0, 0);
    let base = 'FROM material_movements mm JOIN material_lots ml ON mm.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id WHERE 1=1';
    const params = [];
    if (material_lot_id) { base += ' AND mm.material_lot_id = ?'; params.push(material_lot_id); }
    if (work_order_id)   { base += ' AND mm.work_order_id = ?';   params.push(work_order_id); }
    if (project_id)      { base += ' AND mm.project_id = ?';      params.push(project_id); }
    if (movement_type)   { base += ' AND mm.movement_type = ?';   params.push(movement_type); }
    if (date_from)       { base += ' AND mm.created_at >= ?';     params.push(date_from); }
    if (date_to)         { base += ' AND mm.created_at <= ?';     params.push(date_to); }
    const total = get('SELECT COUNT(*) AS c ' + base, params).c;
    const rows = all('SELECT mm.*, ml.lot_no, m.material_name ' + base + ' ORDER BY mm.created_at DESC LIMIT ? OFFSET ?', params.concat([lim, off]));
    res.json({ total, limit: lim, offset: off, count: rows.length, items: rows });
  }));

  app.post('/api/material_movements', wrap((req, res, next) => {
    if (requirePermission('material:write')(req, res)) return;
    try {
      const result = db.transaction(() => _applyMovement(req.body))();
      res.json(result);
    } catch (e) {
      next(e);
    }
  }));

  app.post('/api/material_movements/batch', wrap((req, res) => {
    if (requirePermission('material:write')(req, res)) return;
    const { movements, atomic } = req.body;
    if (!Array.isArray(movements) || movements.length === 0) throw ApiError.validation('movements 数组必填, 不能为空');
    if (movements.length > 500) throw ApiError.validation('movements 单批上限 500 条');
    if (atomic) {
      const ids = [];
      try {
        db.transaction(() => { for (let i = 0; i < movements.length; i++) ids.push(_applyMovement(movements[i]).id); })();
        res.json({ success: true, atomic: true, count: ids.length, ids });
      } catch (e) {
        res.status(e.status || 500).json({ success: false, atomic: true, error: e.message, failed_index: -1 });
      }
    } else {
      const results = [];
      const failed = [];
      for (let i = 0; i < movements.length; i++) {
        try {
          const r = db.transaction(() => _applyMovement(movements[i]))();
          results.push(r);
        } catch (e) {
          failed.push({ index: i, error: e.message });
        }
      }
      res.json({ success: failed.length === 0, atomic: false, count: results.length, ids: results.map(x => x.id), failed });
    }
  }));
};
