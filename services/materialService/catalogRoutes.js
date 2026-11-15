"use strict";

const { wrap } = require("../../middleware/asyncHandler");

function registerCatalogRoutes({ app, helpers }) {
  const { all } = helpers;

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

  app.get("/api/key_components", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id ORDER BY kc.lead_time_weeks DESC"));
  }));

  app.get("/api/key_components/long_leadtime", wrap((_req, res) => {
    res.json(all("SELECT kc.*, m.material_name FROM key_components kc JOIN materials m ON kc.material_id = m.id WHERE kc.lead_time_weeks >= 12 ORDER BY kc.lead_time_weeks DESC"));
  }));
}

module.exports = { registerCatalogRoutes };
