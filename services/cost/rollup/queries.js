"use strict";
// services/cost/rollup/queries.js
// rollup 与 breakdown 共享的 SQL 与工具
// Author: 三狗子 | Date: 2026-06-24

function round2(n) { return Math.round(n * 100) / 100; }

const KEY_COMP_SQL = `
    SELECT
      kc.id                              AS key_component_id,
      m.id                              AS material_id,
      m.material_code,
      m.material_name,
      kc.component_type,
      kc.supplier,
      SUM(ib.quantity)                   AS quantity,
      kc.unit_price                     AS estimated_unit_price,
      kcp.actual_price                  AS actual_unit_price,
      kcp.id                            AS price_id,
      kcp.contract_no,
      kcp.vendor_po,
      kcp.currency,
      kcp.valid_from,
      kcp.valid_to
    FROM key_components kc
    JOIN materials m ON m.id = kc.material_id
    JOIN instance_bom ib
      ON ib.material_id = kc.material_id AND ib.equipment_instance_id = ? AND ib.is_key_component = 1
    LEFT JOIN key_component_prices kcp ON kcp.id = kc.last_price_id
    GROUP BY kc.id
    ORDER BY kc.id
  `;

const NORMAL_MAT_SQL = `
    SELECT
      m.id                              AS material_id,
      m.material_code,
      m.material_name,
      m.material_type,
      m.unit,
      SUM(ib.quantity)                  AS quantity,
      m.estimated_unit_price            AS estimated_unit_price
    FROM instance_bom ib
    JOIN materials m ON m.id = ib.material_id
    WHERE ib.equipment_instance_id = ? AND COALESCE(ib.is_key_component, 0) = 0
    GROUP BY m.id
    ORDER BY m.id
  `;

const HOURS_SQL = `
    SELECT
      COALESCE(SUM(estimated_hours), 0)  AS estimated_hours,
      COALESCE(SUM(actual_hours), 0)     AS actual_hours,
      COUNT(*)                            AS work_order_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
    FROM work_orders
    WHERE equipment_instance_id = ?
  `;

module.exports = { round2, KEY_COMP_SQL, NORMAL_MAT_SQL, HOURS_SQL };
