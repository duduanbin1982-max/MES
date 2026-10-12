"use strict";
// services/masterDataService.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { wrap } = require("../../middleware/asyncHandler");
const { collect } = ctx;

  app.post("/api/mdm/issues/:id/reopen", wrap((req, res) => {
    db.prepare("UPDATE mdm_issue_waivers SET active = 0 WHERE issue_id = ?").run(req.params.id);
    res.json({ ok: true });
  }));

  app.get("/api/mdm/issues", wrap((req, res) => {
    const data = collect();
    let issues = data.issues;
    if (req.query.domain) issues = issues.filter((i) => i.domain === req.query.domain);
    if (req.query.severity) issues = issues.filter((i) => i.severity === req.query.severity);
    res.json({ summary: data.summary, issues: issues.slice(0, Math.min(Number(req.query.limit || 300), 500)) });
  }));
};
