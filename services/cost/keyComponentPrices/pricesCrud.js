"use strict";
// services/cost/keyComponentPrices/pricesCrud.js
// 4 端点:
//   GET    /api/key_components/:id/prices        列出全部合同价
//   GET    /api/key_components/:id/prices/current 当前生效价
//   POST   /api/key_components/:id/prices        新建 (写入即生效)
//   DELETE /api/key_components/prices/:priceId   软删 (valid_to = today)
// Author: 三狗子 | Date: 2026-06-24

const { makeHelpers, nowISO, todayISO } = require("./_helpers");

function register(app, db) {
  const { all, get, run, wrap, writeRoles } = makeHelpers(db);

  // 列出某件全部合同价
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

  // 当前生效合同价
  app.get("/api/key_components/:id/prices/current", wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "key_component id 必填" });
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

  // 新建一条合同价 (写入即生效)
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

  // 软删: 把 valid_to 设为今天
  app.delete("/api/key_components/prices/:priceId", writeRoles, wrap((req, res) => {
    const priceId = parseInt(req.params.priceId, 10);
    if (!priceId) return res.status(400).json({ error: "priceId 必填" });
    const row = get("SELECT * FROM key_component_prices WHERE id = ?", priceId);
    if (!row) return res.status(404).json({ error: "price not found" });
    if (row.valid_to) return res.status(400).json({ error: "该条已停用" });

    const today = todayISO();
    const tx = db.transaction((pid) => {
      run("UPDATE key_component_prices SET valid_to = ? WHERE id = ?", [today, pid]);
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
}

module.exports = { register };