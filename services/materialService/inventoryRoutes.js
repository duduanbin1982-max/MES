"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { queryLowStock } = require("../material/core");

function registerInventoryRoutes({ app, db, helpers, ApiError }) {
  const { all, get } = helpers;

  app.get("/api/inventory", wrap((_req, res) => {
    // 2026-11-07: 前端库存清单有"编码"列, 但原 SQL 没查 material_code (列一直空白)
    res.json(all("SELECT i.*, ml.lot_no, m.id AS material_id, m.material_code, m.material_name FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id ORDER BY m.material_code, i.location, ml.lot_no"));
  }));

  app.get("/api/inventory/alerts", wrap((_req, res) => {
    const rows = queryLowStock(db, { includeSpec: true });
    res.json({ count: rows.length, items: rows });
  }));

  app.get("/api/inventory/lot_trace", wrap((req, res) => {
    const { lot_id } = req.query;
    if (!lot_id) throw ApiError.validation("lot_id 必填");
    const lot = get("SELECT ml.*, m.material_code, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?", lot_id);
    if (!lot) throw ApiError.notFound("lot 不存在");
    const movements = all("SELECT * FROM material_movements WHERE material_lot_id = ? ORDER BY created_at", lot_id);
    const inventory = all("SELECT * FROM inventory WHERE material_lot_id = ?", lot_id);
    res.json({ lot, movements, inventory });
  }));
}

module.exports = { registerInventoryRoutes };
