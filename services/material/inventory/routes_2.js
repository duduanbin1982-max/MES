"use strict";
// services/material/inventory.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { wrap } = require('../../../middleware/asyncHandler');
const { ApiError } = require("../../../app/errors");
const audit = require('../../../app/audit');
const { get, requirePermission, run } = ctx;

  // 2026-11-07 审计修复: 'abc' 之前会穿透成 NaN 并写库 500
  const parseQty = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw ApiError.validation('quantity 必须是 > 0 的数字');
    if (n > 1e9) throw ApiError.validation('quantity 超出上限');
    return Math.round(n * 1e6) / 1e6;
  };

  app.post('/api/inventory/allocate', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || quantity === undefined || quantity === null || quantity === '') throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = parseQty(quantity);

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
      const result = tx();
      audit.record(db, req, {
        action: 'inventory.allocate',
        resource_type: 'material_lot',
        resource_id: material_lot_id,
        after: result,
        diff_summary: '预留 ' + q + ' (WO ' + work_order_id + ')',
      });
      res.json(result);
    } catch (e) { next(e); }
  }));

  app.post('/api/inventory/release', wrap((req, res, next) => {
    if (requirePermission('material:admin')(req, res)) return;
    const { material_lot_id, work_order_id, quantity } = req.body;
    if (!material_lot_id || !work_order_id || quantity === undefined || quantity === null || quantity === '') throw ApiError.validation('material_lot_id/work_order_id/quantity 必填');
    const q = parseQty(quantity);

    const tx = db.transaction(() => {
      // 找该 work_order 的预留
      const alloc = get("SELECT id, quantity, location FROM inventory WHERE material_lot_id = ? AND status = 'allocated'", material_lot_id);
      if (!alloc) throw ApiError.validation('lot ' + material_lot_id + ' 无 allocated 库存')
      if (alloc.quantity < q) throw ApiError.validation('allocated 不足: 现有 ' + alloc.quantity + ', 要释放 ' + q)

      // 2026-11-07 审计修复: inventory 表没有 work_order_id, 用流水反查该工单的净预留量,
      // 防止 A 工单释放掉 B 工单的预留 (原实现只按 lot 取第一条 allocated)。
      // 兼容历史数据: 若该 lot 完全没有"预留:"流水(直接插入的 allocated 行), 则退化为原行为。
      const lotAllocSum = get(
        "SELECT COALESCE(SUM(quantity), 0) AS q FROM material_movements WHERE material_lot_id = ? AND movement_type = 'transfer' AND notes LIKE '预留:%'",
        [material_lot_id]
      );
      if (Number(lotAllocSum.q || 0) > 0) {
        const allocSum = get(
          "SELECT COALESCE(SUM(quantity), 0) AS q FROM material_movements WHERE material_lot_id = ? AND work_order_id = ? AND movement_type = 'transfer' AND notes LIKE '预留:%'",
          [material_lot_id, work_order_id]
        );
        const releaseSum = get(
          "SELECT COALESCE(SUM(quantity), 0) AS q FROM material_movements WHERE material_lot_id = ? AND work_order_id = ? AND movement_type = 'transfer' AND notes LIKE '释放:%'",
          [material_lot_id, work_order_id]
        );
        const remaining = Number(allocSum.q || 0) - Number(releaseSum.q || 0);
        if (remaining <= 0) throw ApiError.validation('工单 ' + work_order_id + ' 在该 lot 上没有可释放的预留');
        if (remaining < q) throw ApiError.validation('该工单预留不足: 剩余 ' + (Math.round(remaining * 1000) / 1000) + ', 要释放 ' + q);
      }

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
      const result = tx();
      audit.record(db, req, {
        action: 'inventory.release',
        resource_type: 'material_lot',
        resource_id: material_lot_id,
        after: result,
        diff_summary: '释放预留 ' + q + ' (WO ' + work_order_id + ')',
      });
      res.json(result);
    } catch (e) { next(e); }
  }));
};
