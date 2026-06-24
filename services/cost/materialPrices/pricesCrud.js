"use strict";
// services/cost/materialPrices/pricesCrud.js
// 3 端点:
//   GET  /api/materials/:id            详情 (含 estimated/actual 单价)
//   PUT  /api/materials/:id/prices      改单价
//   POST /api/materials/prices/bulk     批量更新
// Author: 三狗子 | Date: 2026-06-24

const { makeHelpers, nowISO } = require("./_helpers");

function register(app, db) {
  const { all, get, run, wrap, writeRoles } = makeHelpers(db);

  // 详情
  app.get("/api/materials/:id", wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "material id 必填" });
    const m = get("SELECT * FROM materials WHERE id = ?", id);
    if (!m) return res.status(404).json({ error: "material not found" });
    const used_in = all(
      `SELECT DISTINCT ei.id, ei.instance_code, ei.instance_name
         FROM instance_bom ib JOIN equipment_instances ei ON ei.id = ib.equipment_instance_id
        WHERE ib.material_id = ?`,
      id
    );
    res.json({ material: m, used_in });
  }));

  // 改单价
  app.put("/api/materials/:id/prices", writeRoles, wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "material id 必填" });
    const m = get("SELECT id, estimated_unit_price, actual_unit_price FROM materials WHERE id = ?", id);
    if (!m) return res.status(404).json({ error: "material not found" });

    const { estimated_unit_price, actual_unit_price, notes } = req.body || {};
    const sets = [];
    const params = [];
    if (estimated_unit_price != null) {
      const v = Number(estimated_unit_price);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "estimated_unit_price 必须是非负数" });
      sets.push("estimated_unit_price = ?"); params.push(v);
    }
    if (actual_unit_price != null) {
      const v = Number(actual_unit_price);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "actual_unit_price 必须是非负数" });
      sets.push("actual_unit_price = ?"); params.push(v);
    }
    if (sets.length === 0) return res.status(400).json({ error: "至少给一个价格字段" });
    sets.push("updated_at = ?"); params.push(nowISO());
    params.push(id);
    run(`UPDATE materials SET ${sets.join(", ")} WHERE id = ?`, ...params);
    const after = get("SELECT id, material_code, material_name, unit, estimated_unit_price, actual_unit_price, updated_at FROM materials WHERE id = ?", id);
    res.json({ ok: true, material: after, notes: notes || null });
  }));

  // 批量改价
  app.post("/api/materials/prices/bulk", writeRoles, wrap((req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items 必须是非空数组" });
    if (items.length > 500) return res.status(400).json({ error: "一次最多 500 条" });

    const tx = db.transaction((rows) => {
      const out = { updated: 0, skipped: 0, errors: [] };
      const upd = db.prepare(`UPDATE materials SET estimated_unit_price = COALESCE(?, estimated_unit_price), actual_unit_price = COALESCE(?, actual_unit_price), updated_at = ? WHERE id = ?`);
      const find = db.prepare("SELECT id, material_code FROM materials WHERE id = ?");
      for (const it of rows) {
        const id = parseInt(it.material_id, 10);
        if (!id) { out.skipped++; out.errors.push({ material_id: it.material_id, error: "id 缺失" }); continue; }
        if (!find.get(id)) { out.skipped++; out.errors.push({ material_id: id, error: "not found" }); continue; }
        const est = it.estimated_unit_price != null ? Number(it.estimated_unit_price) : null;
        const act = it.actual_unit_price != null ? Number(it.actual_unit_price) : null;
        if (est != null && (!Number.isFinite(est) || est < 0)) { out.skipped++; out.errors.push({ material_id: id, error: "estimated_unit_price 非法" }); continue; }
        if (act != null && (!Number.isFinite(act) || act < 0)) { out.skipped++; out.errors.push({ material_id: id, error: "actual_unit_price 非法" }); continue; }
        if (est == null && act == null) { out.skipped++; out.errors.push({ material_id: id, error: "两字段都为空" }); continue; }
        upd.run(est, act, nowISO(), id);
        out.updated++;
      }
      return out;
    });
    const result = tx(items);
    res.json({ ok: true, ...result });
  }));
}

module.exports = { register };