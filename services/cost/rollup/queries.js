"use strict";
// services/cost/rollup/queries.js
// rollup 与 breakdown 共享的 SQL 与工具
// 2026-11-02：改为读只读视图（services/cost/rollup/readModel.js），不再直接 JOIN 业务表。
// Author: 三狗子 | Date: 2026-06-24

function round2(n) { return Math.round(n * 100) / 100; }

// 关键件成本（按关键件聚合，含最近合同价）
const KEY_COMP_SQL = `
    SELECT
      key_component_id,
      material_id,
      material_code,
      material_name,
      component_type,
      supplier,
      quantity,
      estimated_unit_price,
      actual_unit_price,
      price_id,
      contract_no,
      vendor_po,
      currency,
      valid_from,
      valid_to
    FROM v_instance_key_component_costs
    WHERE instance_id = ?
    ORDER BY key_component_id
  `;

// 普通物料成本（按物料聚合）
const NORMAL_MAT_SQL = `
    SELECT
      material_id,
      material_code,
      material_name,
      material_type,
      unit,
      quantity,
      estimated_unit_price
    FROM v_instance_material_costs
    WHERE instance_id = ?
    ORDER BY material_id
  `;

// 工时汇总（每实例一行）
const HOURS_SQL = `
    SELECT
      estimated_hours,
      actual_hours,
      work_order_count,
      completed_count
    FROM v_instance_labor_totals
    WHERE instance_id = ?
  `;

module.exports = { round2, KEY_COMP_SQL, NORMAL_MAT_SQL, HOURS_SQL };
