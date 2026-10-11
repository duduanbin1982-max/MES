"use strict";
// services/delivery/readModel/_cost.js
// 单机成本汇总: 优先 project_cost_entries，回退 erp_cost_ledger，算挣值偏差与风险级别。
// (原 services/delivery/readModel.js 第 109-161 行)

function makeCostSummary(ctx, { instanceBudgetAmount }) {
  const { tableExists, safeAll } = ctx;

  function costSummaryForInstance(instance) {
    const id = Number(instance.id);
    const budget = instanceBudgetAmount(instance);
    const progress = Math.max(0, Math.min(100, Number(instance.progress_pct || 0)));
    const projectRows = tableExists("project_cost_entries")
      ? safeAll(`
          SELECT cost_type AS gl_account_code,
                 source_type,
                 SUM(COALESCE(amount, 0)) AS amount,
                 COUNT(*) AS entry_count
          FROM project_cost_entries
          WHERE equipment_instance_id = ?
            AND deleted_at IS NULL
            AND COALESCE(status, 'posted') NOT IN ('void', 'cancelled')
          GROUP BY cost_type, source_type
          ORDER BY ABS(SUM(COALESCE(amount, 0))) DESC
        `, [id])
      : [];
    const erpRows = tableExists("erp_cost_ledger")
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
    const rows = projectRows.length ? projectRows : erpRows;
    const source = projectRows.length ? "project_cost_entries" : "erp_cost_ledger";
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
      source,
      by_account: rows,
    };
  }

  return { costSummaryForInstance };
}

module.exports = { makeCostSummary };
