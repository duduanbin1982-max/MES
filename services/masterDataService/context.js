"use strict";

const createDbHelpers = require("./_db");
const createIssueHelpers = require("./_issues");
const createChecks = require("./_checks");
// services/masterDataService.js 的 register() 前置逻辑


module.exports = function createContext(app, db) {

  db.exec(`
    CREATE TABLE IF NOT EXISTS mdm_issue_waivers (
      issue_id TEXT PRIMARY KEY,
      domain TEXT,
      rule TEXT,
      source TEXT,
      ref_id TEXT,
      reason TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );
  `);
  const { tableCache, columnCache, tableExists, MDM_ALLOWED_TABLES, columns, has, all, get, scanErrors } = createDbHelpers(db);
  const { stableIssueId, ignoredIssueIds, issue, severityRank } = createIssueHelpers({ tableCache, columnCache, tableExists, MDM_ALLOWED_TABLES, columns, has, all, get });
  const { firstTable, countRows, checkMaterials, checkBom, checkDocuments, checkSuppliers, checkProcessAndStations, checkLabor, domainSummary } = createChecks({ tableCache, columnCache, tableExists, MDM_ALLOWED_TABLES, columns, has, all, get, stableIssueId, ignoredIssueIds, issue, severityRank });
  function collect() {
    scanErrors.length = 0;
    const issues = [];
    const domains = [
      checkMaterials(issues),
      checkBom(issues),
      checkDocuments(issues),
      checkSuppliers(issues),
      checkProcessAndStations(issues),
      checkLabor(issues),
    ];
    const ignored = ignoredIssueIds();
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      if (ignored.has(issues[i].id)) issues.splice(i, 1);
    }
    issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const i of issues) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    const avgScore = domains.length ? Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length) : 100;
    return { summary: { domains: domains.length, total_records: domains.reduce((s, d) => s + d.total, 0), issue_count: issues.length, avg_score: avgScore, by_severity: bySeverity, scan_errors: scanErrors.slice() }, domains, issues };
  }
  return { MDM_ALLOWED_TABLES, all, checkBom, checkDocuments, checkLabor, checkMaterials, checkProcessAndStations, checkSuppliers, collect, columnCache, columns, countRows, domainSummary, firstTable, has, ignoredIssueIds, issue, severityRank, stableIssueId, tableCache, tableExists };
};
