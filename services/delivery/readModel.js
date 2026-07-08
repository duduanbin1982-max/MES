"use strict";
const { createPurchaseFollowupReader } = require("./readModel/purchaseFollowups");
const { createExceptionReadModel } = require("./readModel/exceptions");
const { createProjectWorkflowReadModel } = require("./readModel/projectWorkflow");
// services/delivery/readModel.js

function createReadModel(ctx) {
  const { tableExists, has, safeAll, safeGet, enrichEscalation } = ctx;
  const purchaseFollowupReader = createPurchaseFollowupReader(ctx);
  const { purchaseFollowupPath, purchaseFollowupsForInstance } = purchaseFollowupReader;

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







  function getInstances() {
    if (!tableExists("equipment_instances")) return [];
    const c = columns("equipment_instances");
    const field = (name, fallback = "NULL") => c.has(name) ? name : `${fallback} AS ${name}`;
    return safeAll(`
      SELECT id,
             ${field("instance_code", "''")},
             ${field("instance_name", "''")},
             ${field("status", "''")},
             ${field("lifecycle_stage", "''")},
             ${field("progress_pct", "0")},
             ${field("customer_name", "''")},
             ${field("planned_end", "NULL")},
             ${field("contract_amount", "0")},
             ${field("contract_amount_unit", "''")}
      FROM equipment_instances
      ORDER BY id
    `);
  }

  const exceptionReadModel = createExceptionReadModel(ctx, { getInstances, purchaseFollowupPath, severityRank });
  const { collectExceptions, exceptionSummary } = exceptionReadModel;







  function oeeForInstance(instanceId) {
    if (!tableExists("oee_shift_log")) return null;
    const rows = safeAll("SELECT * FROM oee_shift_log WHERE equipment_instance_id = ? AND shift_date >= date('now', '-30 day')", [instanceId]);
    if (!rows.length) return null;
    let planned = 0, operating = 0, output = 0, good = 0, idealTotal = 0, idealCount = 0;
    for (const r of rows) {
      planned += Number(r.planned_minutes || 0);
      operating += Number(r.operating_minutes || 0);
      output += Number(r.total_output || 0);
      good += Number(r.good_output || 0);
      if (r.ideal_cycle_time) { idealTotal += Number(r.ideal_cycle_time); idealCount += 1; }
    }
    const availability = planned > 0 ? operating / planned : 0;
    const ideal = idealCount > 0 ? idealTotal / idealCount : 0;
    const performance = operating > 0 && ideal > 0 ? output * ideal / operating : 0;
    const quality = output > 0 ? good / output : 0;
    return Math.round(availability * performance * quality * 1000) / 10;
  }

  function instanceBudgetAmount(instance) {
    const raw = Number(instance.contract_amount || 0);
    const unit = String(instance.contract_amount_unit || "").toLowerCase();
    if (unit === "wan" || unit === "万元") return raw * 10000;
    return raw;
  }

  function costSummaryForInstance(instance) {
    const id = Number(instance.id);
    const budget = instanceBudgetAmount(instance);
    const progress = Math.max(0, Math.min(100, Number(instance.progress_pct || 0)));
    const rows = tableExists("erp_cost_ledger")
      ? safeAll(`
          SELECT gl_account_code,
                 source_type,
                 SUM(COALESCE(debit_amount,0) - COALESCE(credit_amount,0)) AS amount,
                 COUNT(*) AS entry_count
          FROM erp_cost_ledger
          WHERE equipment_instance_id = ?
          GROUP BY gl_account_code, source_type
          ORDER BY ABS(SUM(COALESCE(debit_amount,0) - COALESCE(credit_amount,0))) DESC
        `, [id])
      : [];
    const actual = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const earnedBudget = budget * (progress / 100);
    const variance = actual - earnedBudget;
    let variancePct = earnedBudget > 0 ? Math.round((variance / earnedBudget) * 1000) / 10 : 0;
    let level = variancePct >= 20 ? "critical" : variancePct >= 10 ? "high" : variancePct >= 5 ? "warning" : "normal";
    if (earnedBudget <= 0 && actual > 0) {
      variancePct = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : 100;
      level = variancePct >= 5 ? "warning" : "normal";
    }
    return {
      budget_amount: Math.round(budget * 100) / 100,
      progress_pct: progress,
      earned_budget: Math.round(earnedBudget * 100) / 100,
      actual_amount: Math.round(actual * 100) / 100,
      variance_amount: Math.round(variance * 100) / 100,
      variance_pct: variancePct,
      risk_level: level,
      by_account: rows,
    };
  }

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
    if (shortageRows.length) actions.push({ type: "kit_shortage", label: "处理缺料", path: "/kit-closure", count: shortageRows.length });
    if (purchaseFollowups.length) actions.push({ type: "purchase_followup", label: "采购跟催", path: purchaseFollowupPath(id), count: purchaseFollowups.length });
    if (ncrRows.length) actions.push({ type: "quality_ncr", label: "关闭NCR", path: "/quality", count: ncrRows.length });
    if (cost.risk_level !== "normal") actions.push({ type: "cost_variance", label: "复核成本", path: "/cost", count: 1 });
    if (active.some((e) => e.escalation_due)) actions.push({ type: "escalation", label: "升级异常", path: "/exceptions", count: active.filter((e) => e.escalation_due).length });
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

  const projectWorkflowReadModel = createProjectWorkflowReadModel(ctx, {
    count,
    countByStatus,
    pct,
    purchaseFollowupPath,
    purchaseFollowupsForInstance,
    costSummaryForInstance,
    riskBreakdownForProject,
    oeeForInstance,
  });
  const { buildProject } = projectWorkflowReadModel;

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








  return {
    collectExceptions,
    exceptionSummary,
    getInstances,
    buildProject,
    buildProjectRiskDrilldown,
  };
}

module.exports = { createReadModel };
