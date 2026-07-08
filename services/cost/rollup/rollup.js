"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/rollup/rollup.js
// GET /api/equipment_instances/:id/cost_rollup
// 主成本归集: 关键件 + 普通物料 + 工时 + 合同毛利
// 聚合逻辑 (aggregateKeyComponents/aggregateMaterials/deriveContractMetrics) 抽到 aggregate.js
// Author: 三狗子 | Date: 2026-06-24

const { KEY_COMP_SQL, NORMAL_MAT_SQL, HOURS_SQL } = require("./queries");
const { round2 } = require("./queries");
const { aggregateKeyComponents, aggregateMaterials, deriveContractMetrics } = require("./aggregate");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  
  app.get('/api/equipment_instances/:id/cost_rollup', wrap((req, res) => {
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', req.params.id);
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

    const contract = deriveContractMetrics(inst, total_actual);

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
        hours_diff: round2(actual_hours - estimated_hours)
      },
      totals: {
        estimated_cost: total_estimated,
        actual_cost:    total_actual,
        cost_diff:      total_diff,
        over_budget_diff,
        under_budget_saved
      },
      project_status,
      contract_yuan: contract.yuan,
      contract_margin: contract.margin,
      contract_margin_pct: contract.margin_pct
    });
  }));
}

module.exports = { register };