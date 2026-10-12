"use strict";
// 问题单构造（原 masterDataService.js 的 register() 前置逻辑）

module.exports = function createIssueHelpers(h) {
  const { all, get, has, columns, tableExists, MDM_ALLOWED_TABLES } = h;

  function stableIssueId(domain, rule, source, refId, title) {
    const raw = [domain, rule, source || "-", refId == null ? "-" : String(refId), title || ""].join("|");
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    return `${domain}_${rule}_${Math.abs(hash)}`;
  }

  function ignoredIssueIds() {
    if (!tableExists("mdm_issue_waivers")) return new Set();
    return new Set(all("SELECT issue_id FROM mdm_issue_waivers WHERE active = 1").map((r) => r.issue_id));
  }

  function issue(list, { domain, rule, severity, title, detail, source, refId, path }) {
    list.push({
      id: stableIssueId(domain, rule, source, refId, title),
      domain,
      rule,
      severity,
      title,
      detail,
      source,
      ref_id: refId == null ? null : String(refId),
      source_path: path,
    });
  }

  function severityRank(sev) {
    return { critical: 4, high: 3, warning: 2, info: 1 }[sev] || 0;
  }

  return { stableIssueId, ignoredIssueIds, issue, severityRank };
};
