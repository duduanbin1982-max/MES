"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function registerCatalogRoutes({ app, helpers, ApiError }) {
  const { all, get, run } = helpers;

  app.get("/api/material-categories", wrap((_req, res) => {
    res.json(all(`SELECT c.*, p.category_name AS parent_name,
                         (SELECT COUNT(*) FROM materials m WHERE m.category_id = c.id) AS material_count
                    FROM material_categories c
                    LEFT JOIN material_categories p ON p.id = c.parent_id
                   WHERE c.is_active = 1
                   ORDER BY c.sort_order, c.id`));
  }));

  app.get("/api/materials", wrap((req, res) => {
    const { is_key_component, is_self_made, category_id } = req.query;
    let sql = `SELECT m.*, c.category_code, c.category_name
                 FROM materials m LEFT JOIN material_categories c ON c.id = m.category_id
                WHERE 1=1`;
    const params = [];
    if (is_key_component) sql += " AND m.is_key_component = 1";
    if (is_self_made) sql += " AND m.is_self_made = 1";
    if (category_id) {
      const ids = [];
      const queue = [Number(category_id)];
      while (queue.length) {
        const id = queue.shift();
        if (!id || ids.includes(id)) continue;
        ids.push(id);
        for (const row of all("SELECT id FROM material_categories WHERE parent_id = ?", [id])) queue.push(Number(row.id));
      }
      if (ids.length) {
        sql += " AND m.category_id IN (" + ids.map(() => "?").join(",") + ")";
        params.push(...ids);
      }
    }
    sql += " ORDER BY m.material_code";
    res.json(all(sql, params));
  }));

  app.put("/api/materials/:id/category", wrap((req, res) => {
    const material = all("SELECT id FROM materials WHERE id = ?", [Number(req.params.id)])[0];
    if (!material) throw new Error("物料不存在");
    const categoryId = req.body?.category_id ? Number(req.body.category_id) : null;
    if (categoryId && !all("SELECT id FROM material_categories WHERE id = ?", [categoryId])[0]) throw new Error("分类不存在");
    all("UPDATE materials SET category_id = ? WHERE id = ?", [categoryId, material.id]);
    res.json({ ok: true });
  }));

  app.post("/api/materials", wrap((req, res) => {
    const body = req.body || {};
    const code = String(body.material_code || "").trim();
    const name = String(body.material_name || "").trim();
    if (!code || !name) throw ApiError.validation("material_code/material_name 必填");
    if (get("SELECT id FROM materials WHERE material_code = ?", [code])) throw ApiError.conflict("物料编码已存在");
    const categoryId = body.category_id ? Number(body.category_id) : null;
    if (categoryId && !get("SELECT id FROM material_categories WHERE id = ?", [categoryId])) throw ApiError.validation("分类不存在");
    if (body.source_type && !["purchased", "self_made", "outsourced"].includes(body.source_type)) throw ApiError.validation("source_type 非法");
    if (body.inventory_policy && !["stock", "project", "none"].includes(body.inventory_policy)) throw ApiError.validation("inventory_policy 非法");
    const result = run(`INSERT INTO materials
      (material_code, material_name, material_type, spec, unit, is_key_component, is_self_made, default_supplier,
       safety_stock, reorder_point, estimated_unit_price, actual_unit_price, notes, category_id, lot_managed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, body.material_type || "purchased", body.spec || null, body.unit || "件",
       body.is_key_component ? 1 : 0, body.is_self_made ? 1 : 0, body.default_supplier || null,
       Number(body.safety_stock || 0), Number(body.reorder_point || 0), Number(body.estimated_unit_price || 0),
       Number(body.actual_unit_price || 0), body.notes || null, categoryId, body.lot_managed ? 1 : 0]);
    res.json({ ok: true, id: result.lastInsertRowid });
  }));

  app.put("/api/materials/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    const current = get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!current) throw ApiError.notFound("物料不存在");
    const body = req.body || {};
    if (body.source_type && !["purchased", "self_made", "outsourced"].includes(body.source_type)) throw ApiError.validation("source_type 非法");
    if (body.inventory_policy && !["stock", "project", "none"].includes(body.inventory_policy)) throw ApiError.validation("inventory_policy 非法");
    const categoryId = body.category_id === undefined ? current.category_id : (body.category_id ? Number(body.category_id) : null);
    if (categoryId && !get("SELECT id FROM material_categories WHERE id = ?", [categoryId])) throw ApiError.validation("分类不存在");
    const code = body.material_code === undefined ? current.material_code : String(body.material_code || "").trim();
    if (!code) throw ApiError.validation("物料编码必填");
    if (code !== current.material_code && get("SELECT id FROM materials WHERE material_code = ? AND id <> ?", [code, id])) throw ApiError.conflict("物料编码已存在");
    run(`UPDATE materials SET material_code=?, material_name=?, material_type=?, spec=?, unit=?, is_key_component=?,
           is_self_made=?, default_supplier=?, safety_stock=?, reorder_point=?, estimated_unit_price=?, actual_unit_price=?,
           notes=?, category_id=?, lot_managed=? WHERE id=?`,
      [code, body.material_name ?? current.material_name, body.material_type ?? current.material_type,
       body.spec === undefined ? current.spec : (body.spec || null), body.unit ?? current.unit,
       body.is_key_component ? 1 : 0, body.is_self_made ? 1 : 0,
       body.default_supplier === undefined ? current.default_supplier : (body.default_supplier || null),
       Number(body.safety_stock ?? current.safety_stock ?? 0), Number(body.reorder_point ?? current.reorder_point ?? 0),
       Number(body.estimated_unit_price ?? current.estimated_unit_price ?? 0), Number(body.actual_unit_price ?? current.actual_unit_price ?? 0),
       body.notes === undefined ? current.notes : (body.notes || null), categoryId, body.lot_managed ? 1 : 0, id]);
    res.json({ ok: true });
  }));

  app.get("/api/key_components", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC"));
  }));

  app.get("/api/key_components/long_leadtime", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 12 ORDER BY kc.lead_time_weeks DESC"));
  }));
}

module.exports = { registerCatalogRoutes };
