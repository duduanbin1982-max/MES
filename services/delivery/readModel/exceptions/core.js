"use strict";

function today() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function instanceMap(instances) {
  return new Map(instances.map((instance) => [Number(instance.id), instance]));
}

function pushException(list, item) {
  const severityMap = { danger: "high", error: "high", fatal: "critical", warn: "warning" };
  const severity = severityMap[item.severity] || item.severity || "info";
  list.push({
    id: item.id || `${item.type}_${list.length + 1}`,
    type: item.type,
    severity,
    title: item.title,
    message: item.message || item.title,
    instance_id: item.instance_id || null,
    instance_code: item.instance_code || null,
    source: item.source || item.type,
    source_path: item.source_path || null,
    owner: item.owner || null,
    due_at: item.due_at || null,
    created_at: item.created_at || null,
    action_label: item.action_label || "查看",
  });
}

function mergeCaseState(ctx, items) {
  if (!items.length) return items;
  const cases = ctx.safeAll(`SELECT * FROM exception_cases WHERE exception_id IN (${items.map(() => "?").join(",")})`, items.map((item) => item.id));
  const caseMap = new Map(cases.map((exceptionCase) => [exceptionCase.exception_id, exceptionCase]));
  return items.map((item) => {
    const exceptionCase = caseMap.get(item.id);
    if (!exceptionCase) return { ...item, case_status: "open", owner_id: null, owner_name: null, priority: item.severity, action_count: 0 };
    return {
      ...item,
      case_status: exceptionCase.status || "open",
      owner_id: exceptionCase.owner_id,
      owner_name: exceptionCase.owner_name,
      priority: exceptionCase.priority || item.severity,
      due_at: exceptionCase.due_at || item.due_at,
      closed_at: exceptionCase.closed_at,
      close_note: exceptionCase.close_note,
      last_action: exceptionCase.last_action,
    };
  });
}

function finalizeExceptions(ctx, helpers, items) {
  const merged = ctx.enrichEscalation(mergeCaseState(ctx, items));
  merged.sort((left, right) => {
    const statusRank = (left.case_status === "closed" ? 0 : 1) - (right.case_status === "closed" ? 0 : 1);
    if (statusRank) return -statusRank;
    const bySeverity = helpers.severityRank(right.severity) - helpers.severityRank(left.severity);
    if (bySeverity) return bySeverity;
    return String(right.created_at || right.due_at || "").localeCompare(String(left.created_at || left.due_at || ""));
  });
  return merged;
}

function exceptionSummary(items) {
  const active = items.filter((item) => item.case_status !== "closed");
  const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
  const byType = {};
  const byStatus = { open: 0, assigned: 0, processing: 0, closed: 0 };
  for (const item of items) {
    byStatus[item.case_status || "open"] = (byStatus[item.case_status || "open"] || 0) + 1;
  }
  for (const item of active) {
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  return { total: active.length, all_total: items.length, by_severity: bySeverity, by_type: byType, by_status: byStatus };
}

module.exports = { exceptionSummary, finalizeExceptions, instanceMap, pushException, today };
