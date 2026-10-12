"use strict";
// services/masterDataService.js 的路由组 1

module.exports = function registerRoutes1(app, db, ctx) {
const { wrap } = require("../../middleware/asyncHandler");
const { collect } = ctx;

  app.get("/api/mdm/overview", wrap((_req, res) => res.json(collect())));

  app.post("/api/mdm/issues/:id/waive", wrap((req, res) => {
    const data = collect();
    const item = data.issues.find((i) => i.id === req.params.id);
    if (!item) {
      db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
        (issue_id, reason, active, closed_at)
        VALUES (?, ?, 1, datetime('now'))`).run(req.params.id, req.body?.reason || "异常中心关闭");
      return res.json({ ok: true, missing: true });
    }
    db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
      (issue_id, domain, rule, source, ref_id, reason, active, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`).run(
      item.id, item.domain, item.rule, item.source, item.ref_id, req.body?.reason || "异常中心关闭"
    );
    res.json({ ok: true, issue: item });
  }));
};
