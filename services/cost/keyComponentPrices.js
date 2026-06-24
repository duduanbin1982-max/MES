"use strict";
// services/keyComponentPrices.js
// 关键件合同价 CRUD + 差价分析
// Author: 三狗子 | Date: 2026-06-24
//
// Endpoints:
//   GET  /api/key_components/:id/prices        列出某件全部合同价 (按 priced_at desc)
//   GET  /api/key_components/:id/prices/current 当前生效价 (last_price_id)
//   POST /api/key_components/:id/prices        新建一条合同价 (写入即生效, 旧的自动 valid_to=valid_from)
//   DELETE /api/key_components/prices/:priceId 软删 (把 valid_to 设为今天)
//   GET  /api/key_components/price_diff        全部件价差汇总 (走 v_key_component_price_diff)
//   GET  /api/key_components/price_diff/summary 总数/超预算/节约

function nowISO() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };

  // ---------- 角色守卫 (复用 middleware/auth.requireRole) ----------
  const { requireRole } = require("../../middleware/auth");

  // 读 = 已登录用户, 写 = admin 或 foreman
  const writeRoles = requireRole("admin", "foreman");

  // ============================================================
  // 列出某件全部合同价
  // ============================================================
  app.get("/api/key_components/:id/prices", wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "key_component id 必填" });
    const kc = get("SELECT id, component_type, supplier, unit_price FROM key_components WHERE id = ?", id);
    if (!kc) return res.status(404).json({ error: "key_component not found" });
    const rows = all(
      `SELECT p.*, u.username AS priced_by_username
         FROM key_component_prices p
         LEFT JOIN users u ON u.id = p.priced_by
        WHERE p.key_component_id = ?
        ORDER BY p.priced_at DESC, p.id DESC`,
      id
    );
    res.json({ key_component: kc, items: rows, count: rows.length });
  }));

  // ============================================================
  // 当前生效合同价
  // ============================================================
  app.get("/api/key_components/:id/prices/current", wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "key_component id 必填" });
    // 优先 last_price_id (active), 若没有 (软删过/未签) -> 取最近一条历史
    const row = get(
      `SELECT kc.id AS key_component_id, kc.component_type, kc.supplier, kc.unit_price AS estimated_price,
              p.id AS price_id, p.actual_price, p.contract_no, p.vendor_po, p.currency,
              p.valid_from, p.valid_to, p.priced_at, p.notes,
              u.username AS priced_by_username,
              ROUND(COALESCE(p.actual_price, 0) - COALESCE(kc.unit_price, 0), 4) AS price_diff,
              (p.id = kc.last_price_id) AS is_current
         FROM key_components kc
         LEFT JOIN key_component_prices p ON p.key_component_id = kc.id
         LEFT JOIN users u ON u.id = p.priced_by
        WHERE kc.id = ?
          AND p.id = COALESCE(kc.last_price_id, (
            SELECT id FROM key_component_prices WHERE key_component_id = kc.id ORDER BY priced_at DESC, id DESC LIMIT 1
          ))`,
      id
    );
    if (!row) return res.status(404).json({ error: "key_component not found" });
    res.json(row);
  }));

  // ============================================================
  // 新建一条合同价 (写入即生效)
  // body: { actual_price, contract_no?, vendor_po?, currency?, valid_from?, valid_to?, notes? }
  // ============================================================
  app.post("/api/key_components/:id/prices", writeRoles, wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "key_component id 必填" });
    const kc = get("SELECT id FROM key_components WHERE id = ?", id);
    if (!kc) return res.status(404).json({ error: "key_component not found" });

    const body = req.body || {};
    const actualPrice = Number(body.actual_price);
    if (!Number.isFinite(actualPrice) || actualPrice < 0) {
      return res.status(400).json({ error: "actual_price 必填且为非负数" });
    }
    const validFrom = body.valid_from || todayISO();
    const validTo = body.valid_to || null; // null = 现行
    const contractNo = body.contract_no || null;
    const vendorPo = body.vendor_po || null;
    const currency = body.currency || "CNY";
    const notes = body.notes || null;
    const pricedBy = req.user && req.user.uid ? req.user.uid : null;

    const r = run(
      `INSERT INTO key_component_prices
         (key_component_id, actual_price, contract_no, vendor_po, currency,
          valid_from, valid_to, notes, priced_by, priced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, actualPrice, contractNo, vendorPo, currency, validFrom, validTo, notes, pricedBy, nowISO()]
    );

    const created = get("SELECT * FROM key_component_prices WHERE id = ?", r.lastInsertRowid);
    res.json({ ok: true, price: created, message: "合同价已生效" });
  }));

  // ============================================================
  // 软删: 把 valid_to 设为今天 (停用而非物理删除)
  // ============================================================
  app.delete("/api/key_components/prices/:priceId", writeRoles, wrap((req, res) => {
    const priceId = parseInt(req.params.priceId, 10);
    if (!priceId) return res.status(400).json({ error: "priceId 必填" });
    const row = get("SELECT * FROM key_component_prices WHERE id = ?", priceId);
    if (!row) return res.status(404).json({ error: "price not found" });
    if (row.valid_to) return res.status(400).json({ error: "该条已停用" });

    const today = todayISO();
    const tx = db.transaction((pid) => {
      run("UPDATE key_component_prices SET valid_to = ? WHERE id = ?", [today, pid]);
      // 把 key_components.last_price_id 指向当前件下最新一条 valid_to IS NULL
      // 软删后: 找该件下"当前 effective 的最新一条"
      // 有效 = valid_to IS NULL, 或 valid_to >= 今天
      // 软删后回退: 同件下最近 priced_at 的另一条 (不限定 valid_to, 走历史回退)
      const next = get(
        `SELECT id FROM key_component_prices
          WHERE key_component_id = ? AND id != ?
          ORDER BY priced_at DESC, id DESC LIMIT 1`,
        row.key_component_id, pid
      );
      run("UPDATE key_components SET last_price_id = ? WHERE id = ?", [next ? next.id : null, row.key_component_id]);
    });
    tx(priceId);
    res.json({ ok: true, message: "已停用" });
  }));

  // ============================================================
  // 全部件价差汇总 (走 v_key_component_price_diff)
  // ============================================================
  app.get("/api/key_components/price_diff", wrap((req, res) => {
    const rows = all(
      "SELECT * FROM v_key_component_price_diff ORDER BY lead_time_weeks DESC, key_component_id"
    );
    res.json({ count: rows.length, items: rows });
  }));

  // ============================================================
  // 价差汇总 (按 cost_status 聚合)
  // ============================================================
  app.get("/api/key_components/price_diff/summary", wrap((req, res) => {
    const rows = all("SELECT * FROM v_key_component_price_diff");
    let totalEstimated = 0;
    let totalActual = 0;
    let pendingCount = 0;
    let onBudgetCount = 0;
    let over10Count = 0;
    let over20Count = 0;
    let overTotalDiff = 0;
    let underSavedDiff = 0;
    for (const r of rows) {
      if (r.estimated_price) totalEstimated += r.estimated_price;
      if (r.actual_price) totalActual += r.actual_price;
      if (!r.actual_price) pendingCount++;
      else if (r.cost_status === "on_or_under_budget") {
        onBudgetCount++;
        if (r.price_diff < 0) underSavedDiff += -r.price_diff;
      } else if (r.cost_status === "over_10pct") {
        over10Count++;
        overTotalDiff += r.price_diff;
      } else {
        over20Count++;
        overTotalDiff += r.price_diff;
      }
    }
    res.json({
      component_count: rows.length,
      contract_signed_count: rows.length - pendingCount,
      pending_count: pendingCount,
      on_or_under_budget_count: onBudgetCount,
      over_10pct_count: over10Count,
      over_20pct_count: over20Count,
      total_estimated_price: Math.round(totalEstimated * 100) / 100,
      total_actual_price: Math.round(totalActual * 100) / 100,
      total_diff: Math.round((totalActual - totalEstimated) * 100) / 100,
      over_budget_diff: Math.round(overTotalDiff * 100) / 100,
      under_budget_saved: Math.round(underSavedDiff * 100) / 100,
    });
  }));
}

module.exports = { register };
