"use strict";
// services/materialPrices.js
// 普通物料价格 CRUD + 批量录入
// Author: 三狗子 | Date: 2026-06-24
//
// 端点:
//   GET    /api/materials/:id              详情 (含 estimated/actual 单价)
//   PUT    /api/materials/:id/prices        改单价 (estimated_unit_price / actual_unit_price)
//   POST   /api/materials/prices/bulk      批量更新 (写=admin/foreman)
//   GET    /api/materials/prices/summary   覆盖率: 总数 / 估价已填 / 实际已填 / 总估价
//
// 数据源:
//   materials 表的 estimated_unit_price, actual_unit_price (migration 016 加的列)

function nowISO() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };

  const { requireRole } = require("../../middleware/auth");
  const writeRoles = requireRole("admin", "foreman");

  // ============================================================
  // GET /api/materials/:id - 详情 (含单价)
  // ============================================================
  app.get("/api/materials/:id", wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "material id 必填" });
    const m = get("SELECT * FROM materials WHERE id = ?", id);
    if (!m) return res.status(404).json({ error: "material not found" });
    // 补: 在哪些 instance BOM 中用过
    const used_in = all(
      `SELECT DISTINCT ei.id, ei.instance_code, ei.instance_name
         FROM instance_bom ib JOIN equipment_instances ei ON ei.id = ib.equipment_instance_id
        WHERE ib.material_id = ?`,
      id
    );
    res.json({ material: m, used_in });
  }));

  // ============================================================
  // PUT /api/materials/:id/prices - 改单价
  // body: { estimated_unit_price?, actual_unit_price?, notes? }
  // ============================================================
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

  // ============================================================
  // POST /api/materials/prices/bulk - 批量改价
  // body: { items: [{ material_id, estimated_unit_price?, actual_unit_price? }, ...] }
  // ============================================================
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

  // ============================================================
  // GET /api/materials/prices/summary - 覆盖率
  // ============================================================
  app.get("/api/materials/prices/summary", wrap((req, res) => {
    const total = get("SELECT COUNT(*) AS c FROM materials").c;
    const est_filled = get("SELECT COUNT(*) AS c FROM materials WHERE estimated_unit_price > 0").c;
    const act_filled = get("SELECT COUNT(*) AS c FROM materials WHERE actual_unit_price > 0").c;
    const tot_est = get("SELECT COALESCE(SUM(estimated_unit_price), 0) AS s FROM materials").s;
    const tot_act = get("SELECT COALESCE(SUM(actual_unit_price), 0) AS s FROM materials").s;
    // 哪些物料在 BOM 中用到了
    const in_bom = get(`SELECT COUNT(DISTINCT material_id) AS c FROM instance_bom`).c;
    const in_bom_est_filled = get(`
      SELECT COUNT(DISTINCT ib.material_id) AS c
        FROM instance_bom ib JOIN materials m ON m.id = ib.material_id
       WHERE m.estimated_unit_price > 0
    `).c;
    res.json({
      materials_total: total,
      estimated_filled: est_filled,
      actual_filled: act_filled,
      estimated_coverage_pct: total ? Math.round(est_filled * 10000 / total) / 100 : 0,
      actual_coverage_pct:    total ? Math.round(act_filled * 10000 / total) / 100 : 0,
      total_estimated_unit_price_sum: Number(tot_est.toFixed(2)),
      total_actual_unit_price_sum:    Number(tot_act.toFixed(2)),
      used_in_bom_count: in_bom,
      used_in_bom_estimated_filled: in_bom_est_filled,
      used_in_bom_coverage_pct: in_bom ? Math.round(in_bom_est_filled * 10000 / in_bom) / 100 : 0
    });
  }));
}

module.exports = { register };
