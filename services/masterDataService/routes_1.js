"use strict";
// services/masterDataService.js 的路由组 1

module.exports = function registerRoutes1(app, db, ctx) {
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { ApiError } = require("../../app/errors");
const { collect } = ctx;

  app.get("/api/mdm/overview", wrap((req, res) => {
    const data = collect();
    if (req.query.include_issues === "0" || req.query.include_issues === "false") data.issues = [];
    res.json(data);
  }));

  app.post("/api/mdm/issues/:id/waive", wrap((req, res) => {
    const data = collect();
    const item = data.issues.find((i) => i.id === req.params.id);
    if (!item) throw ApiError.notFound("主数据问题不存在或已忽略");
    db.prepare(`INSERT OR REPLACE INTO mdm_issue_waivers
      (issue_id, domain, rule, source, ref_id, reason, active, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`).run(
      item.id, item.domain, item.rule, item.source, item.ref_id, req.body?.reason || "异常中心关闭"
    );
    audit.record(db, req, { action: "mdm.issue.waive", resource_type: "mdm_issue", resource_id: item.id, before: item, after: { reason: req.body?.reason || "异常中心关闭" }, diff_summary: `忽略主数据问题 ${item.title}` });
    res.json({ ok: true, issue: item });
  }));
};
