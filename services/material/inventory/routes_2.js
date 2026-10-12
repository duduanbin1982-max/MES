"use strict";
// services/material/inventory.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const { get, requirePermission, run } = ctx;

  app.post('/api/inventory/allocate', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = Number(quantity);
    if (q <= 0) throw ApiError.validation('quantity 必须 > 0');

    const tx = db.transaction(() => {
      const inv = get("SELECT id, quantity, status, location FROM inventory WHERE material_lot_id = ? AND status = 'available'", material_lot_id);
      if (!inv) throw ApiError.validation('lot ' + material_lot_id + ' 无 available 库存')
      if (inv.quantity < q) throw ApiError.validation('available 不足: 现有 ' + inv.quantity + ', 要预留 ' + q)

      // 拆成两行: available 减, allocated 加 (同 lot 同 location)
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, inv.id]);
      const existingAlloc = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'allocated'", [material_lot_id, inv.location]);
      if (existingAlloc) {
        run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [q, existingAlloc.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'allocated' FROM inventory WHERE id = ?", [q, inv.id]);
      }
      // 记 movement (work_order 关联)
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '预留: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, inv.id]);
      return { ok: true, lot_id: material_lot_id, allocated_qty: q, location: inv.location };
    });
    try {
      res.json(tx());
    } catch (e) { next(e); }
  }));

  app.post('/api/inventory/release', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || !quantity) throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = Number(quantity);
    if (q <= 0) throw ApiError.validation('quantity 必须 > 0');

    const tx = db.transaction(() => {
      // 找该 work_order 的预留
      const alloc = get("SELECT id, quantity, location FROM inventory WHERE material_lot_id = ? AND status = 'allocated'", material_lot_id);
      if (!alloc) throw ApiError.validation('lot ' + material_lot_id + ' 无 allocated 库存')
      if (alloc.quantity < q) throw ApiError.validation('allocated 不足: 现有 ' + alloc.quantity + ', 要释放 ' + q)

      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [q, alloc.id]);
      const existingAvail = get("SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'", [material_lot_id, alloc.location]);
      if (existingAvail) {
        run("UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [q, existingAvail.id]);
      } else {
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) SELECT material_lot_id, location, ?, unit, 'available' FROM inventory WHERE id = ?", [q, alloc.id]);
      }
      run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, to_location, work_order_id, notes) SELECT material_lot_id, 'transfer', ?, unit, location, location, ?, '释放: ' || ? FROM inventory WHERE id = ?",
        [q, work_order_id, 'work_order ' + work_order_id, alloc.id]);
      return { ok: true, lot_id: material_lot_id, released_qty: q, location: alloc.location };
    });
    try {
      res.json(tx());
    } catch (e) { next(e); }
  }));
};
