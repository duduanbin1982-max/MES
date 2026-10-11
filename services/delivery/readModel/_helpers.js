"use strict";
// services/delivery/readModel/_helpers.js
// 通用小工具: 计数 / 按状态计数 / 百分比 / 严重度排序 / 拼接带 instance_id 的跳转路径。
// (原 services/delivery/readModel.js 第 13-43 行)

function makeReadHelpers(ctx) {
  const { tableExists, has, safeAll, safeGet } = ctx;

  function count(table, where = "1=1", params = []) {
    if (!tableExists(table)) return 0;
    const row = safeGet(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params);
    return row ? Number(row.c || 0) : 0;
  }

  function countByStatus(table, instanceColumn, instanceId) {
    if (!tableExists(table) || !has(table, "status")) return {};
    const where = has(table, instanceColumn) ? `WHERE ${instanceColumn} = ?` : "";
    const params = has(table, instanceColumn) ? [instanceId] : [];
    const rows = safeAll(`SELECT status, COUNT(*) AS c FROM ${table} ${where} GROUP BY status`, params);
    return Object.fromEntries(rows.map((r) => [r.status || "unknown", Number(r.c || 0)]));
  }

  function pct(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  function severityRank(severity) {
    return { critical: 4, high: 3, warning: 2, info: 1 }[severity] || 0;
  }

  function appendProjectQuery(path, instanceId, extra = {}) {
    const [base, query = ""] = String(path || "/delivery").split("?");
    const search = new URLSearchParams(query);
    for (const [key, value] of Object.entries({ instance_id: instanceId, from: "delivery", ...extra })) {
      if (value !== null && value !== undefined && String(value).trim() !== "") search.set(key, String(value));
    }
    const queryString = search.toString();
    return queryString ? `${base}?${queryString}` : base;
  }

  return { count, countByStatus, pct, severityRank, appendProjectQuery };
}

module.exports = { makeReadHelpers };
