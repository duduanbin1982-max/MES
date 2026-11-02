"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/rollup/breakdown.js
// GET /api/equipment_instances/:id/cost_rollup/breakdown
// 明细行: 关键件 + 普通物料 + 工时 + 成本台账, 每行 cost_status
// 2026-11-02：跨域读改为只读视图（readModel.js），不再直接 JOIN 业务表
// Author: 三狗子 | Date: 2026-06-24

const { round2 } = require("./queries");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  // 成本台账视图依赖 project_cost_entries；老库/精简测试库里可能没有该表，查询失败按空处理
  const safeAll = (sql, ...p) => {
    try { return all(sql, ...p); } catch (_error) { return []; }
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

    const projectCostRows = safeAll(`
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
        0 AS price_diff,
        status AS cost_status,
        cost_type,
        cost_type_label,
        source_type,
        vendor,
        occurred_on,
        notes
      FROM v_instance_cost_entry_lines
      WHERE instance_id = ?
    `, req.params.id);

    const items = [...keyRows, ...matRows, ...projectCostRows];
    if (laborRow && (Number(laborRow.estimated_total) > 0 || Number(laborRow.actual_total) > 0)) {
      items.push(laborRow);
    }

    const totals = items.reduce((acc, r) => ({
      estimated: round2(acc.estimated + Number(r.estimated_total || 0)),
      actual:    round2(acc.actual    + Number(r.actual_total    || 0)),
      diff:      round2(acc.diff      + Number(r.price_diff      || 0))
    }), { estimated: 0, actual: 0, diff: 0 });

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
