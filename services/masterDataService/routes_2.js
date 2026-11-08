"use strict";
// services/masterDataService.js 的路由组 2

module.exports = function registerRoutes2(app, db, ctx) {
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { ApiError } = require("../../app/errors");
const { collect } = ctx;

  app.post("/api/mdm/issues/:id/reopen", wrap((req, res) => {
    const waiver = db.prepare("SELECT * FROM mdm_issue_waivers WHERE issue_id = ? AND active = 1").get(req.params.id);
    if (!waiver) throw ApiError.notFound("该问题未处于忽略状态");
    db.prepare("UPDATE mdm_issue_waivers SET active = 0 WHERE issue_id = ?").run(req.params.id);
    audit.record(db, req, { action: "mdm.issue.reopen", resource_type: "mdm_issue", resource_id: req.params.id, before: waiver, after: { active: 0 }, diff_summary: `恢复主数据问题 ${req.params.id}` });
    res.json({ ok: true });
  }));

  app.get("/api/mdm/waivers", wrap((req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const active = req.query.active === undefined ? null : Number(req.query.active);
    const rows = active === null
      ? db.prepare("SELECT * FROM mdm_issue_waivers ORDER BY created_at DESC LIMIT ?").all(limit)
      : db.prepare("SELECT * FROM mdm_issue_waivers WHERE active = ? ORDER BY created_at DESC LIMIT ?").all(active, limit);
    res.json({ waivers: rows });
  }));

  app.get("/api/mdm/issues", wrap((req, res) => {
    const data = collect();
    let issues = data.issues;
    if (req.query.domain) issues = issues.filter((i) => i.domain === req.query.domain);
    if (req.query.severity) issues = issues.filter((i) => i.severity === req.query.severity);
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 500)) : 300;
    const total = issues.length;
    res.json({ summary: data.summary, issues: issues.slice(0, limit), total, truncated: total > limit });
  }));
};
