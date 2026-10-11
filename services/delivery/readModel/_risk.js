"use strict";
// services/delivery/readModel/_risk.js
// 项目风险聚合（打分 + 快速动作）与风险下钻（里程碑 + 明细清单）。
// (原 services/delivery/readModel.js 第 163-312 行)

function makeRiskModel(ctx, deps) {
  const { severityRank, appendProjectQuery, purchaseFollowupPath, purchaseFollowupsForInstance, costSummaryForInstance } = deps;
  const { tableExists, safeAll } = ctx;

  function riskBreakdownForProject(instance, exceptions) {
    const id = Number(instance.id);
    const active = exceptions.filter((e) => Number(e.instance_id) === id && e.case_status !== "closed");
    const byType = {};
    const bySeverity = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const e of active) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    }
    const shortageRows = tableExists("shortage_cases")
      ? safeAll(`
          SELECT sc.*, m.material_code, m.material_name, wo.wo_code, wo.title AS work_order_title
          FROM shortage_cases sc
          LEFT JOIN materials m ON m.id = sc.material_id
          LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
          WHERE sc.equipment_instance_id = ?
            AND COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
          ORDER BY
            CASE sc.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
            sc.updated_at DESC
          LIMIT 100
        `, [id])
      : [];
    const ncrRows = tableExists("ncr_reports")
      ? safeAll(`
          SELECT n.*,
            (
              SELECT COUNT(*) FROM capa_actions c
              WHERE c.ncr_id = n.id AND COALESCE(c.status, '') != 'closed'
            ) AS open_capa_count,
            (
              SELECT COUNT(*) FROM ncr_rechecks r
              WHERE r.ncr_id = n.id AND r.result = 'pass'
            ) AS pass_recheck_count
          FROM ncr_reports n
          WHERE n.equipment_instance_id = ?
            AND n.closed_at IS NULL
          ORDER BY
            CASE n.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END,
            n.created_at DESC
          LIMIT 100
        `, [id])
      : [];
    const purchaseFollowups = purchaseFollowupsForInstance(id);
    const overdueFollowups = purchaseFollowups.filter((row) => row.is_overdue);
    const blockingFollowups = purchaseFollowups.filter((row) => row.is_blocking);
    const cost = costSummaryForInstance(instance);
    const costRiskScore = { critical: 4, high: 3, warning: 2, normal: 0 }[cost.risk_level] || 0;
    const score = active.reduce((sum, e) => sum + severityRank(e.severity), 0) + costRiskScore + (overdueFollowups.length ? 2 : purchaseFollowups.length ? 1 : 0);
    const riskLevel = score >= 12 ? "critical" : score >= 6 ? "high" : score >= 2 ? "warning" : "normal";
    const actions = [];
    if (shortageRows.length) actions.push({ type: "kit_shortage", label: "处理缺料", path: appendProjectQuery("/kit-closure", id, { segment: "kit" }), count: shortageRows.length });
    if (purchaseFollowups.length) actions.push({ type: "purchase_followup", label: "采购跟催", path: purchaseFollowupPath(id), count: purchaseFollowups.length });
    if (ncrRows.length) actions.push({ type: "quality_ncr", label: "关闭NCR", path: appendProjectQuery("/quality", id, { segment: "quality" }), count: ncrRows.length });
    if (cost.risk_level !== "normal") actions.push({ type: "cost_variance", label: "复核成本", path: appendProjectQuery("/cost", id, { segment: "cost" }), count: 1 });
    if (active.some((e) => e.escalation_due)) actions.push({ type: "escalation", label: "升级异常", path: appendProjectQuery("/exceptions", id, { segment: "exceptions" }), count: active.filter((e) => e.escalation_due).length });
    return {
      score,
      risk_level: riskLevel,
      by_type: byType,
      by_severity: bySeverity,
      exception_count: active.length,
      shortage_count: shortageRows.length,
      purchase_followup_count: purchaseFollowups.length,
      purchase_followup_blocking: blockingFollowups.length,
      purchase_followup_overdue: overdueFollowups.length,
      ncr_count: ncrRows.length,
      cost_risk_level: cost.risk_level,
      cost_variance_pct: cost.variance_pct,
      quick_actions: actions,
    };
  }

  function buildProjectRiskDrilldown(instance, exceptions) {
    const id = Number(instance.id);
    const active = exceptions.filter((e) => Number(e.instance_id) === id && e.case_status !== "closed");
    const byType = {};
    for (const e of active) byType[e.type] = (byType[e.type] || 0) + 1;
    const shortages = tableExists("shortage_cases")
      ? safeAll(`
          SELECT sc.*, m.material_code, m.material_name, wo.wo_code, wo.title AS work_order_title, u.full_name AS owner_full_name
          FROM shortage_cases sc
          LEFT JOIN materials m ON m.id = sc.material_id
          LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
          LEFT JOIN users u ON u.id = sc.owner_id
          WHERE sc.equipment_instance_id = ?
            AND COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
          ORDER BY
            CASE sc.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
            sc.updated_at DESC
        `, [id])
      : [];
    const ncrs = tableExists("ncr_reports")
      ? safeAll(`
          SELECT n.*, u.full_name AS created_by_name,
            (
              SELECT COUNT(*) FROM capa_actions c
              WHERE c.ncr_id = n.id AND COALESCE(c.status, '') != 'closed'
            ) AS open_capa_count,
            (
              SELECT COUNT(*) FROM ncr_rechecks r
              WHERE r.ncr_id = n.id AND r.result = 'pass'
            ) AS pass_recheck_count
          FROM ncr_reports n
          LEFT JOIN users u ON u.id = n.created_by
          WHERE n.equipment_instance_id = ?
            AND n.closed_at IS NULL
          ORDER BY
            CASE n.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END,
            n.created_at DESC
        `, [id])
      : [];
    const purchaseFollowups = purchaseFollowupsForInstance(id);
    const cost = costSummaryForInstance(instance);
    const milestones = [
      { key: "exceptions", label: "异常待办", value: active.length, level: active.some((e) => e.severity === "critical") ? "critical" : active.some((e) => e.severity === "high") ? "high" : active.length ? "warning" : "normal" },
      { key: "shortage", label: "缺料项", value: shortages.length, level: shortages.some((s) => s.priority === "critical") ? "critical" : shortages.some((s) => s.priority === "high") ? "high" : shortages.length ? "warning" : "normal" },
      { key: "ncr", label: "未闭环NCR", value: ncrs.length, level: ncrs.some((n) => n.severity === "critical") ? "critical" : ncrs.some((n) => n.severity === "major") ? "high" : ncrs.length ? "warning" : "normal" },
      { key: "cost", label: "成本偏差", value: cost.variance_pct, suffix: "%", level: cost.risk_level },
    ];
    return {
      project: {
        id,
        instance_code: instance.instance_code,
        instance_name: instance.instance_name,
        customer_name: instance.customer_name,
        planned_end: instance.planned_end,
        progress_pct: Number(instance.progress_pct || 0),
      },
      summary: riskBreakdownForProject(instance, exceptions),
      milestones,
      exceptions: active,
      shortages,
      purchase_followups: purchaseFollowups,
      ncrs,
      cost,
    };
  }

  return { riskBreakdownForProject, buildProjectRiskDrilldown };
}

module.exports = { makeRiskModel };
