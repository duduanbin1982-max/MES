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
  const columns = all("PRAGMA table_info(materials)").map((column) => column.name);
  const hasPolicy = columns.includes("inventory_policy");
  const hasCriticality = columns.includes("criticality");
  const hasAbc = columns.includes("abc_class");
  const extraFields = (hasCriticality ? ", m.criticality" : "") + (hasAbc ? ", m.abc_class" : "");
  const fields = includeSpec
    ? `m.id, m.material_code, m.material_name, m.spec, m.unit, m.safety_stock, m.reorder_point${extraFields}`
    : `m.id, m.material_code, m.material_name, m.safety_stock, m.reorder_point${extraFields}`;
  const countField = includeSpec ? ', COUNT(i.id) as lot_count' : '';
  const policyWhere = hasPolicy ? " AND m.inventory_policy = 'stock'" : "";
  const rows = all(
    `SELECT ${fields},
            COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END), 0) as available_qty${countField}
     FROM materials m
     LEFT JOIN material_lots ml ON ml.material_id = m.id
     LEFT JOIN inventory i ON i.material_lot_id = ml.id
     WHERE (COALESCE(m.safety_stock, 0) > 0 OR COALESCE(m.reorder_point, 0) > 0)${policyWhere}
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
  }).filter((row) => row.available_qty < row.threshold).map((row) => {
    const criticality = String(row.criticality || "normal");
    const abcClass = String(row.abc_class || "C").toUpperCase();
    const criticalityScore = criticality === "critical" ? 3 : (criticality === "important" ? 2 : 1);
    const abcScore = abcClass === "A" ? 3 : (abcClass === "B" ? 2 : 1);
    const priorityScore = criticalityScore * 2 + abcScore;
    const priority = priorityScore >= 9 ? "P1" : (priorityScore >= 7 ? "P2" : "P3");
    const suggestedQty = Math.ceil(Number(row.shortage_qty || 0) * 1000) / 1000;
    const days = priority === "P1" ? 0 : (priority === "P2" ? 3 : 7);
    const suggestedDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Object.assign({}, row, {
      criticality,
      abc_class: abcClass,
      priority,
      priority_score: priorityScore,
      suggested_qty: suggestedQty,
      suggested_date: suggestedDate,
    });
  });
  // P1/P2 优先，其次按缺口数量
  items.sort((a, b) => (b.priority_score - a.priority_score) || (b.shortage_qty - a.shortage_qty));
  return items;
}

module.exports = { makeDbHelpers, queryLowStock };

