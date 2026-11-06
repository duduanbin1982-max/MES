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
 * 2026-11-07 审计修复:
 *   - 触发线 = max(safety_stock, reorder_point): 再订货点通常高于安全库存,
 *     只比安全库存会漏报 (原实现)
 *   - 只配了 reorder_point 的物料也纳入 (原 WHERE safety_stock > 0 直接排除)
 *   - 返回 threshold / shortage_qty / severity, 供前端与 ANDON 直接用
 * @returns [{id, material_code, material_name, safety_stock, reorder_point, available_qty, threshold, shortage_qty, severity}]
 */
function queryLowStock(db, { includeSpec = false } = {}) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const fields = includeSpec
    ? `m.id, m.material_code, m.material_name, m.spec, m.unit, m.safety_stock, m.reorder_point`
    : `m.id, m.material_code, m.material_name, m.safety_stock, m.reorder_point`;
  const countField = includeSpec ? ', COUNT(i.id) as lot_count' : '';
  const rows = all(
    `SELECT ${fields},
            COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) as available_qty${countField}
     FROM materials m
     LEFT JOIN material_lots ml ON ml.material_id = m.id
     LEFT JOIN inventory i ON i.material_lot_id = ml.id
     WHERE COALESCE(m.safety_stock, 0) > 0 OR COALESCE(m.reorder_point, 0) > 0
     GROUP BY m.id`
  );
  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const items = rows.map((row) => {
    const available = toNumber(row.available_qty);
    const threshold = Math.max(toNumber(row.safety_stock), toNumber(row.reorder_point));
    return Object.assign({}, row, {
      available_qty: available,
      safety_stock: toNumber(row.safety_stock),
      reorder_point: toNumber(row.reorder_point),
      threshold,
      shortage_qty: Math.round((threshold - available) * 1000) / 1000,
      severity: available <= 0 ? 'critical' : (available < threshold * 0.5 ? 'high' : 'warning'),
    });
  }).filter((row) => row.available_qty < row.threshold);
  items.sort((a, b) => b.shortage_qty - a.shortage_qty);
  return items;
}

module.exports = { makeDbHelpers, queryLowStock };

