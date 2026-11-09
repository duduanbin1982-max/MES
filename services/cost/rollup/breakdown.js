"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/rollup/breakdown.js
// GET /api/equipment_instances/:id/cost_rollup/breakdown
// 明细行: 关键件 + 普通物料 + 工时 + 成本台账, 每行 cost_status
// 2026-11-02：跨域读改为只读视图（readModel.js），不再直接 JOIN 业务表
// Author: 三狗子 | Date: 2026-06-24

const { round2 } = require("./queries");
const { KEY_COMPONENT_PRICE_MULTIPLIER, KEY_COMPONENT_PRICE_UNIT } = require("../units");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  // 成本台账视图依赖 project_cost_entries；老库/精简测试库里可能没有该表，查询失败按空处理
  const safeAll = (sql, ...p) => {
    try { return all(sql, ...p); } catch (_error) { return []; }
  };
  const safeGet = (sql, ...p) => {
    try { return get(sql, ...p); } catch (_error) { return null; }
  };

  app.get('/api/equipment_instances/:id/cost_rollup/breakdown', wrap((req, res) => {
    const inst = get('SELECT id, instance_code, instance_name FROM v_instance_contract_summary WHERE id = ?', req.params.id);
    if (!inst) return res.status(404).json({ error: 'equipment_instance not found' });

    const keyRows = all(`
      SELECT
        'key_component' AS line_type,
        bom_id,
        key_component_id AS item_id,
        material_code,
        material_name,
        component_type,
        supplier,
        quantity,
        estimated_unit_price,
        actual_unit_price,
        contract_no,
        ROUND(estimated_unit_price * quantity, 2) AS estimated_total,
        ROUND(COALESCE(actual_unit_price, estimated_unit_price) * quantity, 2) AS actual_total,
        ROUND(COALESCE(actual_unit_price, estimated_unit_price) * quantity - estimated_unit_price * quantity, 2) AS price_diff,
        ROUND(estimated_unit_price * quantity * ${KEY_COMPONENT_PRICE_MULTIPLIER}, 2) AS estimated_total_yuan,
        ROUND(COALESCE(actual_unit_price, estimated_unit_price) * quantity * ${KEY_COMPONENT_PRICE_MULTIPLIER}, 2) AS actual_total_yuan,
        CASE
          WHEN actual_unit_price IS NULL THEN 'no_contract_yet'
          WHEN actual_unit_price <= estimated_unit_price THEN 'on_or_under_budget'
          WHEN actual_unit_price > estimated_unit_price * 1.2 THEN 'over_20pct'
          ELSE 'over_10pct'
        END AS cost_status
      FROM v_instance_bom_key_component_lines
      WHERE instance_id = ?
    `, req.params.id);

    const matRows = all(`
      SELECT
        'material' AS line_type,
        bom_id,
        material_id AS item_id,
        material_code,
        material_name,
        material_type,
        unit,
        quantity,
        estimated_unit_price,
        estimated_unit_price AS actual_unit_price,
        NULL AS contract_no,
        ROUND(estimated_unit_price * quantity, 2) AS estimated_total,
        ROUND(estimated_unit_price * quantity, 2) AS actual_total,
        0 AS price_diff,
        'estimated_only' AS cost_status
      FROM v_instance_bom_material_lines
      WHERE instance_id = ?
    `, req.params.id);

    const laborRow = get(`
      SELECT
        'labor' AS line_type,
        NULL AS bom_id,
        NULL AS item_id,
        'WO-LABOR' AS material_code,
        '\u5de5\u65f6\u5408\u8ba1' AS material_name,
        NULL AS material_type,
        'h' AS unit,
        NULL AS quantity,
        NULL AS estimated_unit_price,
        NULL AS actual_unit_price,
        NULL AS contract_no,
        estimated_hours AS estimated_total,
        actual_hours AS actual_total,
        (actual_hours - estimated_hours) AS price_diff,
        CASE
          WHEN actual_hours > estimated_hours * 1.1 THEN 'over_10pct'
          WHEN actual_hours < estimated_hours        THEN 'under_budget'
          ELSE 'on_or_under_budget'
        END AS cost_status
      FROM v_instance_labor_totals
      WHERE instance_id = ?
    `, req.params.id);

    const hasFx = Boolean(safeGet("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cost_fx_rates'"));
    const projectCostRows = hasFx ? safeAll(`
      SELECT
        'project_cost_entry' AS line_type,
        bom_node_id AS bom_id,
        item_id,
        cost_type AS material_code,
        description AS material_name,
        cost_type AS material_type,
        currency AS unit,
        1 AS quantity,
        amount AS estimated_unit_price,
        amount AS actual_unit_price,
        source_ref AS contract_no,
        amount AS estimated_total,
        amount AS actual_total,
        ROUND(amount * COALESCE(f.rate_to_cny, 1), 2) AS amount_cny,
        ROUND(amount * COALESCE(f.rate_to_cny, 1), 2) AS estimated_total_yuan,
        ROUND(amount * COALESCE(f.rate_to_cny, 1), 2) AS actual_total_yuan,
        0 AS price_diff,
        status AS cost_status,
        cost_type,
        cost_type_label,
        source_type,
        vendor,
        occurred_on,
        notes
      FROM v_instance_cost_entry_lines e
      LEFT JOIN cost_fx_rates f ON f.currency = e.currency
      WHERE e.instance_id = ?
    `, req.params.id) : safeAll(`
      SELECT
        'project_cost_entry' AS line_type, bom_node_id AS bom_id, item_id,
        cost_type AS material_code, description AS material_name, cost_type AS material_type,
        currency AS unit, 1 AS quantity, amount AS estimated_unit_price, amount AS actual_unit_price,
        source_ref AS contract_no, amount AS estimated_total, amount AS actual_total,
        amount AS amount_cny, amount AS estimated_total_yuan, amount AS actual_total_yuan,
        0 AS price_diff, status AS cost_status, cost_type, cost_type_label, source_type, vendor, occurred_on, notes
      FROM v_instance_cost_entry_lines
      WHERE instance_id = ?
    `, req.params.id);

    const items = [...keyRows, ...matRows, ...projectCostRows];
    if (laborRow && (Number(laborRow.estimated_total) > 0 || Number(laborRow.actual_total) > 0)) {
      items.push(laborRow);
    }

    // 明细 totals 统一为金额（元）。labor 行保留工时字段供旧调用展示，但不把小时数当金额累加。
    const rateRow = safeGet("SELECT value FROM system_settings WHERE key = 'labor_rate_per_hour'");
    const hourlyRate = Math.max(0, Number(rateRow?.value || process.env.LABOR_RATE_PER_HOUR || 200) || 200);
    const laborLedger = projectCostRows.filter((r) => r.cost_type === "labor").reduce((sum, r) => sum + Number(r.amount_cny || r.amount || 0), 0);
    const laborEstimatedHours = Number(laborRow?.estimated_total || 0);
    const laborActualHours = Number(laborRow?.actual_total || 0);
    const laborEstimatedCost = round2(laborEstimatedHours * hourlyRate);
    const laborActualCost = laborLedger > 0 ? round2(laborLedger) : round2(laborActualHours * hourlyRate);
    const otherProjectCosts = projectCostRows.filter((r) => r.cost_type !== "labor").reduce((sum, r) => sum + Number(r.amount_cny || r.amount || 0), 0);
    const totals = {
      estimated: round2(
        keyRows.reduce((sum, r) => sum + Number(r.estimated_total_yuan || 0), 0) +
        matRows.reduce((sum, r) => sum + Number(r.estimated_total || 0), 0) +
        laborEstimatedCost + otherProjectCosts
      ),
      actual: round2(
        keyRows.reduce((sum, r) => sum + Number(r.actual_total_yuan || 0), 0) +
        matRows.reduce((sum, r) => sum + Number(r.actual_total || 0), 0) +
        laborActualCost + otherProjectCosts
      ),
      labor_hours: { estimated: laborEstimatedHours, actual: laborActualHours },
      labor_cost: { estimated: laborEstimatedCost, actual: laborActualCost, source: laborLedger > 0 ? "project_cost_entries" : "hours_rate" },
      hourly_rate: hourlyRate,
      currency: "CNY",
      key_component_price_unit: KEY_COMPONENT_PRICE_UNIT,
    };
    totals.diff = round2(totals.actual - totals.estimated);

    res.json({
      equipment_instance_id: Number(req.params.id),
      instance_code: inst.instance_code,
      instance_name: inst.instance_name,
      count: items.length,
      items,
      totals
    });
  }));
}

module.exports = { register };
