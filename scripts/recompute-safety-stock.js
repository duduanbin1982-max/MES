// scripts/recompute-safety-stock.js
// P2-10 安全库存自动计算
//   算法: 90 天日均消耗 * 7 (7 天缓冲) -> materials.safety_stock
//   排除: safety_stock=0 的物料 (未启用安全库存)
//   排除: 90 天内无任何 issue movement 的物料 (无数据, 不动)
//   限制: max 1,000,000 (避免异常数据)
//
// Author: 三狗子 | Date: 2026-06-25
"use strict";
const path = require("path");
const db = require(path.join(__dirname, "..", "db"));

const DAYS = 90;
const BUFFER_DAYS = 7;
const MAX_SAFETY = 1_000_000;

const candidates = db.prepare(`
  SELECT m.id, m.material_code, m.material_name, m.unit, m.safety_stock AS old_stock
  FROM materials m
  WHERE m.safety_stock > 0
`).all();

let updated = 0, skipped = 0, noData = 0;
const tx = db.transaction((rows) => {
  for (const m of rows) {
    const issue = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM material_movements
      WHERE material_lot_id IN (SELECT id FROM material_lots WHERE material_id = ?)
        AND movement_type IN ('issue', 'transfer')
        AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(m.id, DAYS);
    const totalIssued = issue.total || 0;
    if (totalIssued <= 0) { noData++; continue; }
    const daily = totalIssued / DAYS;
    let newStock = Math.ceil(daily * BUFFER_DAYS);
    if (newStock > MAX_SAFETY) newStock = MAX_SAFETY;
    if (newStock === m.old_stock) { skipped++; continue; }
    db.prepare("UPDATE materials SET safety_stock = ?, reorder_point = ? WHERE id = ?")
      .run(newStock, Math.ceil(newStock * 0.8), m.id);
    updated++;
    console.log(`  ${m.material_code} ${m.material_name} (${m.unit}): ${m.old_stock} -> ${newStock} (日均 ${daily.toFixed(2)} x ${BUFFER_DAYS})`);
  }
});
tx(candidates);

console.log(`\n=== 完成 ===`);
console.log(`  候选: ${candidates.length}`);
console.log(`  更新: ${updated}`);
console.log(`  跳过(无变化): ${skipped}`);
console.log(`  跳过(无消耗): ${noData}`);
