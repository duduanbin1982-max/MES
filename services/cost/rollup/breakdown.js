"use strict";
const { wrap } = require('../../../middleware/asyncHandler');
// services/cost/rollup/breakdown.js
// GET /api/equipment_instances/:id/cost_rollup/breakdown
// 明细行: 关键件 + 普通物料 + 工时, 每行 cost_status
// Author: 三狗子 | Date: 2026-06-24

const { round2 } = require("./queries");

function register(app, db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  

  app.get('/api/equipment_instances/:id/cost_rollup/breakdown', wrap((req, res) => {
    const inst = get('SELECT * FROM equipment_instances WHERE id = ?', req.params.id);
    if (!inst) return res.status(404).json({ error: 'equipment_instance not found' });

    const keyRows = all(`
      SELECT
        'key_component' AS line_type,
        ib.id           AS bom_id,
        kc.id           AS item_id,
        m.material_code,
        m.material_name,
        kc.component_type,
        kc.supplier,
        ib.quantity,
        kc.unit_price   AS estimated_unit_price,
        kcp.actual_price AS actual_unit_price,
        kcp.contract_no,
        ROUND(kc.unit_price * ib.quantity, 2) AS estimated_total,
        ROUND(COALESCE(kcp.actual_price, kc.unit_price) * ib.quantity, 2) AS actual_total,
        ROUND(COALESCE(kcp.actual_price, kc.unit_price) * ib.quantity - kc.unit_price * ib.quantity, 2) AS price_diff,
        CASE
          WHEN kcp.actual_price IS NULL THEN 'no_contract_yet'
          WHEN kcp.actual_price <= kc.unit_price THEN 'on_or_under_budget'
          WHEN kcp.actual_price > kc.unit_price * 1.2 THEN 'over_20pct'
          ELSE 'over_10pct'
        END AS cost_status
      FROM instance_bom ib
      JOIN key_components kc ON kc.material_id = ib.material_id
      JOIN materials m       ON m.id = ib.material_id
      LEFT JOIN key_component_prices kcp ON kcp.id = kc.last_price_id
      WHERE ib.equipment_instance_id = ? AND ib.is_key_component = 1
    `, req.params.id);

    const matRows = all(`
      SELECT
        'material' AS line_type,
        ib.id      AS bom_id,
        m.id       AS item_id,
        m.material_code,
        m.material_name,
        m.material_type,
        m.unit,
        ib.quantity,
        m.estimated_unit_price AS estimated_unit_price,
        m.estimated_unit_price AS actual_unit_price,
        NULL AS contract_no,
        ROUND(m.estimated_unit_price * ib.quantity, 2) AS estimated_total,
        ROUND(m.estimated_unit_price * ib.quantity, 2) AS actual_total,
        0 AS price_diff,
        'estimated_only' AS cost_status
      FROM instance_bom ib
      JOIN materials m ON m.id = ib.material_id
      WHERE ib.equipment_instance_id = ? AND COALESCE(ib.is_key_component, 0) = 0
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
      FROM (
        SELECT
          COALESCE(SUM(estimated_hours), 0) AS estimated_hours,
          COALESCE(SUM(actual_hours), 0)    AS actual_hours
        FROM work_orders WHERE equipment_instance_id = ?
      )
    `, req.params.id);

    const items = [...keyRows, ...matRows];
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