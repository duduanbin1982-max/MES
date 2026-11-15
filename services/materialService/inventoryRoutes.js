"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { queryLowStock } = require("../material/core");

function registerInventoryRoutes({ app, db, helpers, ApiError }) {
  const { all, get } = helpers;
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  app.get("/api/inventory", wrap((_req, res) => {
    // 2026-11-07: 前端库存清单有"编码"列, 但原 SQL 没查 material_code (列一直空白)
    res.json(all("SELECT i.*, ml.lot_no, m.id AS material_id, m.material_code, m.material_name FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id ORDER BY m.material_code, i.location, ml.lot_no"));
  }));

  app.get("/api/inventory/alerts", wrap((_req, res) => {
    const rows = queryLowStock(db, { includeSpec: true });
    res.json({ count: rows.length, items: rows });
  }));

  function nextPrNo() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = get("SELECT COUNT(*) c FROM purchase_requisitions WHERE pr_no LIKE ?", [`PR-${day}-%`]);
    return `PR-${day}-${String(Number(row?.c || 0) + 1).padStart(3, "0")}`;
  }

  app.post("/api/inventory/purchase-requisitions", wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw ApiError.validation("items 必填");
    if (items.length > 200) throw ApiError.validation("items 单次最多 200 条");
    const normalized = [];
    for (const item of items) {
      const materialId = Number(item.material_id);
      const quantity = Number(item.quantity);
      if (!materialId || !(quantity > 0)) throw ApiError.validation("material_id/quantity 必须有效");
      const material = get("SELECT id, unit FROM materials WHERE id = ?", [materialId]);
      if (!material) throw ApiError.notFound("物料不存在: " + materialId);
      normalized.push({
        material_id: materialId,
        quantity,
        unit: item.unit || material.unit || "件",
        priority: item.priority || "P3",
        suggested_date: item.suggested_date || null,
        notes: item.notes || null,
      });
    }
    const requestedBy = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const prNo = nextPrNo();
    const tx = db.transaction(() => {
      const result = run("INSERT INTO purchase_requisitions (pr_no, status, requested_by, notes) VALUES (?, 'draft', ?, ?)",
        [prNo, requestedBy, req.body?.notes || "低库存自动补货建议生成"]);
      const prId = result.lastInsertRowid;
      for (const item of normalized) {
        run(`INSERT INTO purchase_requisition_items (pr_id, material_id, quantity, unit, priority, suggested_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [prId, item.material_id, item.quantity, item.unit, item.priority, item.suggested_date, item.notes]);
      }
      return { id: Number(prId), pr_no: prNo, item_count: normalized.length };
    });
    res.json({ ok: true, ...tx() });
  }));

  app.get("/api/inventory/purchase-requisitions", wrap((req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const rows = all("SELECT * FROM purchase_requisitions ORDER BY id DESC LIMIT ?", [limit]);
    for (const row of rows) {
      row.items = all(`SELECT pri.*, m.material_code, m.material_name
                         FROM purchase_requisition_items pri JOIN materials m ON m.id = pri.material_id
                        WHERE pri.pr_id = ? ORDER BY pri.id`, [row.id]);
    }
    res.json(rows);
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
