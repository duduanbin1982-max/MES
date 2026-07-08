"use strict";
// services/kitCheckCore.js
// P1-3 共享齐套检查核心: BOM聚合 + 库存查询 + 缺口计算
// 消除 materialPlanner.js 与 kitCheck.js 之间的 60+ 行重复代码
// Author: 三狗子 | Date: 2026-06-26

/**
 * 查询指定实例的 BOM (排除总装/虚项/替代料)
 * @returns [{material_id, quantity, scrap_factor, tier, part_number, material_code, material_name, unit, ...}]
 */
function getBomRows(db, instanceId) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  return all(
    `SELECT ib.*, m.material_code, m.material_name, m.safety_stock, m.unit AS material_unit
     FROM instance_bom ib
     LEFT JOIN materials m ON ib.material_id = m.id
     WHERE ib.equipment_instance_id = ? AND ib.tier > 0 AND ib.is_phantom = 0 AND ib.is_alternative = 0
     ORDER BY ib.tier, ib.id`,
    instanceId
  );
}

/**
 * 按 material_id 聚合 BOM 需求
 * @returns {[material_id]: {material_code, material_name, unit, required_qty, safety_stock, is_key, lead_time, bom_nodes}}
 */
function aggregateDemand(db, bomRows) {
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const demandMap = {};
  for (const b of bomRows) {
    if (!b.material_id) continue;
    const key = b.material_id;
    if (!demandMap[key]) {
      // 查是否关键件 (可选, 用于分级预警)
      const kc = get("SELECT lead_time_weeks FROM key_components WHERE material_id = ?", b.material_id);
      demandMap[key] = {
        material_id: b.material_id,
        material_code: b.material_code || "N/A",
        material_name: b.material_name || b.part_number || "未知",
        unit: b.unit || b.material_unit || "件",
        required_qty: 0,
        safety_stock: b.safety_stock || 0,
        is_key: !!kc,
        lead_time_weeks: kc ? kc.lead_time_weeks : null,
        bom_nodes: [],
      };
    }
    const qty = (b.quantity || 1) * (b.scrap_factor || 1);
    demandMap[key].required_qty += qty;
    demandMap[key].bom_nodes.push({
      bom_id: b.id, tier: b.tier, part_number: b.part_number,
      qty_per: b.quantity, scrap: b.scrap_factor
    });
  }
  return demandMap;
}

/**
 * 查询指定 material_ids 的可用库存
 * @returns {[material_id]: available_qty}
 */
function getStockMap(db, materialIds) {
  if (!materialIds.length) return {};
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const placeholders = materialIds.map(() => "?").join(",");
  const invRows = all(
    `SELECT ml.material_id, SUM(i.quantity) AS available_qty
     FROM inventory i
     JOIN material_lots ml ON i.material_lot_id = ml.id
     WHERE ml.material_id IN (${placeholders}) AND i.status = 'available'
     GROUP BY ml.material_id`,
    materialIds
  );
  const stockMap = {};
  for (const r of invRows) stockMap[r.material_id] = r.available_qty;
  return stockMap;
}

/**
 * 计算齐套项明细
 * @returns [{material_id, material_code, material_name, unit, required_qty, available_qty, shortage_qty, fulfill_rate, status, ...}]
 */
function computeKitItems(demandMap, stockMap) {
  const items = [];
  for (const [mid, d] of Object.entries(demandMap)) {
    const available = stockMap[Number(mid)] || 0;
    const required = Math.ceil(d.required_qty * 100) / 100;
    const shortage = Math.max(0, required - available);
    const rate = required > 0 ? Math.round((Math.min(available, required) / required) * 100) : 100;
    const status = shortage === 0 ? "ok"
      : available === 0 ? "empty"
      : available >= required * 0.5 ? "low"
      : "critical";

    items.push({
      material_id: Number(mid),
      material_code: d.material_code,
      material_name: d.material_name,
      unit: d.unit,
      required_qty: required,
      available_qty: Math.round(available * 100) / 100,
      shortage_qty: Math.round(shortage * 100) / 100,
      fulfill_rate: rate,
      status,
      safety_stock: d.safety_stock,
      below_safety: available < d.safety_stock,
      is_key: d.is_key,
      lead_time_weeks: d.lead_time_weeks,
      bom_nodes: (d.bom_nodes || []).slice(0, 3),
    });
  }
  items.sort((a, b) => a.fulfill_rate - b.fulfill_rate || b.required_qty - a.required_qty);
  return items;
}

module.exports = { getBomRows, aggregateDemand, getStockMap, computeKitItems };

