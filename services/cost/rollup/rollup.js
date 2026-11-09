"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/rollup/rollup.js
// GET /api/equipment_instances/:id/cost_rollup
// 主成本归集: 关键件 + 普通物料 + 工时 + 合同毛利
// 聚合逻辑 (aggregateKeyComponents/aggregateMaterials/deriveContractMetrics) 抽到 aggregate.js
// 2026-11-02：跨域读改为只读视图（readModel.js）
// Author: 三狗子 | Date: 2026-06-24

const { KEY_COMP_SQL, NORMAL_MAT_SQL, HOURS_SQL } = require("./queries");
const { round2 } = require("./queries");
const { aggregateKeyComponents, aggregateMaterials, deriveContractMetrics } = require("./aggregate");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const safeAll = (sql, ...p) => { try { return all(sql, ...p); } catch (_error) { return []; } };
  const safeGet = (sql, ...p) => { try { return get(sql, ...p) || null; } catch (_error) { return null; } };

  app.get('/api/equipment_instances/:id/cost_rollup', wrap((req, res) => {
    const inst = get(
      `SELECT id, instance_code, instance_name, customer_name, contract_no,
              contract_amount, contract_amount_unit, status, progress_pct
       FROM v_instance_contract_summary WHERE id = ?`,
      req.params.id
    );
    if (!inst) return res.status(404).json({ error: 'equipment_instance not found' });

    const keys  = all(KEY_COMP_SQL,   req.params.id);
    const mats  = all(NORMAL_MAT_SQL, req.params.id);
    const hours = get(HOURS_SQL,      req.params.id);

    const keyAgg = aggregateKeyComponents(keys);
    const matAgg = aggregateMaterials(mats);

    const estimated_hours = Number(hours.estimated_hours || 0);
    const actual_hours    = Number(hours.actual_hours    || 0);

    const total_estimated = round2(keyAgg.estimated_total + matAgg.estimated_total);
    const total_actual    = round2(keyAgg.actual_total    + matAgg.actual_total);
    const total_diff      = round2(total_actual - total_estimated);
    const over_budget_diff = round2(
      keyAgg.rows.filter(r => r.actual_unit_price != null && r.actual_unit_price > r.estimated_unit_price)
                 .reduce((s, r) => s + r.price_diff, 0)
    );
    const under_budget_saved = round2(
      keyAgg.rows.filter(r => r.actual_unit_price != null && r.actual_unit_price < r.estimated_unit_price)
                 .reduce((s, r) => s + (-r.price_diff), 0)
    );

    let project_status;
    if (keyAgg.over_budget > 0) project_status = 'over_budget';
    else if (keyAgg.pending > 0) project_status = 'partial';
    else if (keyAgg.rows.length > 0) project_status = 'fully_contracted';
    else project_status = 'no_key_components';

    // 成本台账（project_cost_entries）：归集外协/折旧/返工/质量损失，以及已过账人工。
    // 人工金额优先取台账；没有台账人工时才用 工时 × 费率 估算，避免重复计入。
    const ledgerRows = safeAll(`SELECT cost_type, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
      FROM project_cost_entries WHERE equipment_instance_id = ? AND deleted_at IS NULL AND status = 'posted'
      GROUP BY cost_type`, req.params.id);
    const ledgerByType = {};
    let ledgerTotal = 0;
    for (const row of ledgerRows) {
      ledgerByType[row.cost_type] = { count: Number(row.cnt || 0), amount: round2(row.total) };
      ledgerTotal += Number(row.total) || 0;
    }
    const otherCostKeys = ["outsourcing", "depreciation", "rework", "quality_loss"];
    const otherCosts = round2(otherCostKeys.reduce((sum, key) => sum + (ledgerByType[key]?.amount || 0), 0));
    const ledgerLabor = round2(ledgerByType.labor?.amount || 0);
    const rateRow = safeGet("SELECT value FROM system_settings WHERE key = 'labor_rate_per_hour'");
    const hourlyRate = Math.max(0, Number(rateRow?.value || process.env.LABOR_RATE_PER_HOUR || 200) || 200);
    const laborEstimatedCost = round2(estimated_hours * hourlyRate);
    const laborHoursCost = round2(actual_hours * hourlyRate);
    const laborActualCost = ledgerLabor > 0 ? ledgerLabor : laborHoursCost;
    const laborCostSource = ledgerLabor > 0 ? "project_cost_entries" : "hours_rate";
    const estimatedCostFull = round2(total_estimated + laborEstimatedCost);
    const actualCostFull = round2(total_actual + laborActualCost + otherCosts);
    const costDiffFull = round2(actualCostFull - estimatedCostFull);
    const contract = deriveContractMetrics(inst, total_actual);
    const marginFull = contract.yuan == null ? null : round2(contract.yuan - actualCostFull);
    const marginPctFull = contract.yuan == null || contract.yuan <= 0 ? null : round2((contract.yuan - actualCostFull) / contract.yuan * 100);
    const ledger = {
      entries: ledgerRows.reduce((sum, row) => sum + Number(row.cnt || 0), 0),
      total: round2(ledgerTotal),
      by_type: ledgerByType,
      other_costs: otherCosts,
      labor_actual: ledgerLabor,
      material_actual: round2(ledgerByType.material?.amount || 0),
    };

    res.json({
      equipment_instance: {
        id: inst.id,
        instance_code: inst.instance_code,
        instance_name: inst.instance_name,
        customer_name: inst.customer_name,
        contract_no: inst.contract_no,
        contract_amount: inst.contract_amount != null ? Number(inst.contract_amount) : null,
        contract_amount_unit: inst.contract_amount_unit || 'wan',
        status: inst.status,
        progress_pct: inst.progress_pct != null ? Number(inst.progress_pct) : null
      },
      key_components: {
        count: keyAgg.rows.length,
        contract_signed_count: keyAgg.signed,
        pending_count: keyAgg.pending,
        over_budget_count: keyAgg.over_budget,
        estimated_total: keyAgg.estimated_total,
        actual_total: keyAgg.actual_total,
        price_diff: round2(keyAgg.actual_total - keyAgg.estimated_total)
      },
      materials: {
        count: matAgg.rows.length,
        estimated_total: matAgg.estimated_total,
        actual_total: matAgg.actual_total
      },
      labor: {
        work_order_count: hours.work_order_count,
        completed_count: hours.completed_count,
        estimated_hours,
        actual_hours,
        hours_diff: round2(actual_hours - estimated_hours),
        hourly_rate: hourlyRate,
        estimated_cost: laborEstimatedCost,
        actual_cost: laborActualCost,
        cost_source: laborCostSource
      },
      totals: {
        estimated_cost: total_estimated,
        actual_cost:    total_actual,
        cost_diff:      total_diff,
        estimated_cost_full: estimatedCostFull,
        actual_cost_full: actualCostFull,
        cost_diff_full: costDiffFull,
        labor_estimated_cost: laborEstimatedCost,
        labor_actual_cost: laborActualCost,
        other_costs: otherCosts,
        over_budget_diff,
        under_budget_saved
      },
      ledger,
      project_status,
      contract_yuan: contract.yuan,
      contract_margin: contract.margin,
      contract_margin_pct: contract.margin_pct,
      contract_margin_full: marginFull,
      contract_margin_pct_full: marginPctFull,
      currency: "CNY",
    });
  }));
}

module.exports = { register };
