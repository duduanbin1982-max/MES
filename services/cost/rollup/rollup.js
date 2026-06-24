"use strict";
// services/cost/rollup/rollup.js
// GET /api/equipment_instances/:id/cost_rollup
// 主成本归集: 关键件 + 普通物料 + 工时 + 合同毛利
// Author: 三狗子 | Date: 2026-06-24

const { round2, KEY_COMP_SQL, NORMAL_MAT_SQL, HOURS_SQL } = require("./queries");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const wrap = (h) => (req, res) => { try { h(req, res); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } };
  app.get('/api/equipment_instances/:id/cost_rollup', wrap((req, res) => {
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', req.params.id);
    if (!inst) return res.status(404).json({ error: 'equipment_instance not found' });

    const keys  = all(KEY_COMP_SQL,   req.params.id);
    const mats  = all(NORMAL_MAT_SQL, req.params.id);
    const hours = get(HOURS_SQL,      req.params.id);

    let key_estimated_total = 0, key_actual_total = 0, key_signed = 0, key_pending = 0, key_over_budget = 0;
    const key_rows = keys.map(k => {
      const q = Number(k.quantity || 0);
      const est_unit = Number(k.estimated_unit_price || 0);
      const has_contract = k.actual_unit_price != null;
      const act_unit = has_contract ? Number(k.actual_unit_price) : est_unit;
      const est_total = round2(est_unit * q);
      const act_total = round2(act_unit * q);
      const diff = round2(act_total - est_total);
      key_estimated_total += est_total;
      key_actual_total    += act_total;
      if (has_contract) key_signed++; else key_pending++;
      if (has_contract && k.actual_unit_price > k.estimated_unit_price) key_over_budget++;
      let cost_status;
      if (!has_contract) cost_status = 'no_contract_yet';
      else if (k.actual_unit_price <= k.estimated_unit_price) cost_status = 'on_or_under_budget';
      else if (k.actual_unit_price > k.estimated_unit_price * 1.2) cost_status = 'over_20pct';
      else cost_status = 'over_10pct';
      return {
        key_component_id: k.key_component_id,
        material_code: k.material_code,
        material_name: k.material_name,
        component_type: k.component_type,
        supplier: k.supplier,
        quantity: q,
        estimated_unit_price: est_unit,
        actual_unit_price: has_contract ? Number(k.actual_unit_price) : null,
        estimated_total: est_total,
        actual_total: act_total,
        price_diff: diff,
        contract_no: k.contract_no,
        currency: k.currency || 'CNY',
        cost_status
      };
    });
    key_estimated_total = round2(key_estimated_total);
    key_actual_total    = round2(key_actual_total);

    let mat_estimated_total = 0;
    const mat_rows = mats.map(m => {
      const q = Number(m.quantity || 0);
      const unit = Number(m.estimated_unit_price || 0);
      const est_total = round2(unit * q);
      mat_estimated_total += est_total;
      return {
        material_id: m.material_id,
        material_code: m.material_code,
        material_name: m.material_name,
        material_type: m.material_type,
        unit: m.unit,
        quantity: q,
        unit_price: unit,
        estimated_total: est_total,
        actual_total: est_total
      };
    });
    mat_estimated_total = round2(mat_estimated_total);
    const mat_actual_total = mat_estimated_total;

    const estimated_hours = Number(hours.estimated_hours || 0);
    const actual_hours    = Number(hours.actual_hours    || 0);

    const total_estimated = round2(key_estimated_total + mat_estimated_total);
    const total_actual    = round2(key_actual_total    + mat_actual_total);
    const total_diff      = round2(total_actual - total_estimated);
    const over_budget_diff = round2(
      key_rows.filter(r => r.actual_unit_price != null && r.actual_unit_price > r.estimated_unit_price)
              .reduce((s, r) => s + r.price_diff, 0)
    );
    const under_budget_saved = round2(
      key_rows.filter(r => r.actual_unit_price != null && r.actual_unit_price < r.estimated_unit_price)
              .reduce((s, r) => s + (-r.price_diff), 0)
    );

    let project_status;
    if (key_over_budget > 0) project_status = 'over_budget';
    else if (key_pending > 0) project_status = 'partial';
    else if (key_rows.length > 0) project_status = 'fully_contracted';
    else project_status = 'no_key_components';

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
        count: key_rows.length,
        contract_signed_count: key_signed,
        pending_count: key_pending,
        over_budget_count: key_over_budget,
        estimated_total: key_estimated_total,
        actual_total: key_actual_total,
        price_diff: round2(key_actual_total - key_estimated_total)
      },
      materials: {
        count: mat_rows.length,
        estimated_total: mat_estimated_total,
        actual_total: mat_actual_total
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
      // 合同金额单位换算 -> 元
      // contract_amount_unit = 'wan' 时 * 10000, 'yuan' 时原值
      contract_yuan: (function () {
        const a = inst.contract_amount;
        if (a == null) return null;
        const u = inst.contract_amount_unit || 'wan';
        return round2(Number(a) * (u === 'wan' ? 10000 : 1));
      })(),
      contract_margin: (function () {
        const a = inst.contract_amount;
        if (a == null) return null;
        const u = inst.contract_amount_unit || 'wan';
        const y = Number(a) * (u === 'wan' ? 10000 : 1);
        return round2(y - total_actual);
      })(),
      contract_margin_pct: (function () {
        const a = inst.contract_amount;
        if (a == null) return null;
        const u = inst.contract_amount_unit || 'wan';
        const y = Number(a) * (u === 'wan' ? 10000 : 1);
        if (y <= 0) return null;
        return round2((y - total_actual) / y * 100);
      })()
    });
  }));
}

module.exports = { register };