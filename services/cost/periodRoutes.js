"use strict";
// 成本期间关账/审批 API（2026-11-09 成本审计）
const { wrap } = require("../../middleware/asyncHandler");
const { requireRole } = require("../../middleware/auth");
const audit = require("../../app/audit");

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const adminOnly = requireRole("admin");

function registerPeriodRoutes(app, db) {
  const get = (sql, p = []) => db.prepare(sql).get(...p);
  const all = (sql, p = []) => db.prepare(sql).all(...p);
  const run = (sql, p = []) => db.prepare(sql).run(...p);

  app.get("/api/cost_periods", wrap((req, res) => {
    const where = req.query.period ? "WHERE period_key = ?" : "";
    const params = req.query.period ? [String(req.query.period)] : [];
    res.json({ periods: all(`SELECT * FROM cost_periods ${where} ORDER BY period_key DESC`, [...params]) });
  }));

  app.post("/api/cost_periods/:period/lock", adminOnly, wrap((req, res) => {
    const period = String(req.params.period);
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period 必须是 YYYY-MM" });
    const current = get("SELECT * FROM cost_periods WHERE period_key = ?", [period]);
    if (current && current.status === "approved") return res.status(409).json({ error: "期间已审批，不能直接锁定" });
    run(`INSERT INTO cost_periods (period_key, status, locked_by, locked_at, updated_at)
      VALUES (?, 'locked', ?, datetime('now'), datetime('now'))
      ON CONFLICT(period_key) DO UPDATE SET status='locked', locked_by=excluded.locked_by, locked_at=datetime('now'), updated_at=datetime('now')`,
      [period, req.user?.uid || req.user?.id || null]);
    audit.record(db, req, { action: "cost.period.lock", resource_type: "cost_period", resource_id: period, after: { status: "locked" }, diff_summary: `锁定会计期间 ${period}` });
    res.json({ ok: true, period, status: "locked" });
  }));

  app.post("/api/cost_periods/:period/approve", adminOnly, wrap((req, res) => {
    const period = String(req.params.period);
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period 必须是 YYYY-MM" });
    run(`INSERT INTO cost_periods (period_key, status, approved_by, approved_at, updated_at)
      VALUES (?, 'approved', ?, datetime('now'), datetime('now'))
      ON CONFLICT(period_key) DO UPDATE SET status='approved', approved_by=excluded.approved_by, approved_at=datetime('now'), updated_at=datetime('now')`,
      [period, req.user?.uid || req.user?.id || null]);
    audit.record(db, req, { action: "cost.period.approve", resource_type: "cost_period", resource_id: period, after: { status: "approved" }, diff_summary: `审批会计期间 ${period}` });
    res.json({ ok: true, period, status: "approved" });
  }));

  app.post("/api/cost_periods/:period/reopen", adminOnly, wrap((req, res) => {
    const period = String(req.params.period);
    if (!PERIOD_RE.test(period)) return res.status(400).json({ error: "period 必须是 YYYY-MM" });
    run(`INSERT INTO cost_periods (period_key, status, updated_at)
      VALUES (?, 'open', datetime('now'))
      ON CONFLICT(period_key) DO UPDATE SET status='open', updated_at=datetime('now')`, [period]);
    audit.record(db, req, { action: "cost.period.reopen", resource_type: "cost_period", resource_id: period, after: { status: "open" }, diff_summary: `反关账期间 ${period}` });
    res.json({ ok: true, period, status: "open" });
  }));
}

function registerFxRoutes(app, db) {
  const all = (sql, p = []) => db.prepare(sql).all(...p);
  const adminOnlyFx = requireRole("admin");
  app.get("/api/cost_fx_rates", wrap((_req, res) => {
    res.json({ rates: all("SELECT * FROM cost_fx_rates ORDER BY currency") });
  }));
  app.put("/api/cost_fx_rates/:currency", adminOnlyFx, wrap((req, res) => {
    const currency = String(req.params.currency || "").trim().toUpperCase();
    const rate = Number(req.body?.rate_to_cny);
    if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: "currency 必须是 3 位币种代码" });
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e6) return res.status(400).json({ error: "rate_to_cny 必须大于 0" });
    db.prepare(`INSERT INTO cost_fx_rates (currency, rate_to_cny, updated_by, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(currency) DO UPDATE SET rate_to_cny=excluded.rate_to_cny, updated_by=excluded.updated_by, updated_at=datetime('now')`)
      .run(currency, rate, req.user?.uid || req.user?.id || null);
    audit.record(db, req, { action: "cost.fx.update", resource_type: "cost_fx_rate", resource_id: currency, after: { rate_to_cny: rate }, diff_summary: `更新汇率 ${currency}` });
    res.json({ ok: true, currency, rate_to_cny: rate });
  }));
}

module.exports = { registerPeriodRoutes, registerFxRoutes };
