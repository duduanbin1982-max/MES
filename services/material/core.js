// services/material/core.js
// 物料 service 共享 helper — 从 materialService.js 拆分 (brooks-debt R1)
// P2: 新增 queryLowStock() 供 inventory/alerts 和 andonService 共用
'use strict';

function makeDbHelpers(db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);
  return { all, get, run };
}

/**
 * 查询低于安全库存的物料 (供 inventory/alerts 和 ANDON 扫描共用)
 * @returns [{id, material_code, material_name, spec, unit, safety_stock, reorder_point, available_qty, lot_count}]
 */
function queryLowStock(db, { includeSpec = false } = {}) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const fields = includeSpec
    ? `m.id, m.material_code, m.material_name, m.spec, m.unit, m.safety_stock, m.reorder_point`
    : `m.id, m.material_code, m.material_name, m.safety_stock`;
  const countField = includeSpec ? ', COUNT(i.id) as lot_count' : '';
  return all(
    `SELECT ${fields},
            COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) as available_qty${countField}
     FROM materials m
     LEFT JOIN material_lots ml ON ml.material_id = m.id
     LEFT JOIN inventory i ON i.material_lot_id = ml.id
     WHERE m.safety_stock > 0
     GROUP BY m.id
     HAVING available_qty < m.safety_stock
     ORDER BY (m.safety_stock - available_qty) DESC`
  );
}

module.exports = { makeDbHelpers, queryLowStock };

