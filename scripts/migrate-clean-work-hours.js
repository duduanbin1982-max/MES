"use strict";
// scripts/migrate-clean-work-hours.js
// 2026-11-06（工时与报工审计 WH-4 数据治理）：
//   · 清理 process_standard_hours 中"孤儿"定额行（process_node_id 非数字节点，如 'undefined'）
//   · 报告 work_report_details 中孤儿报工（工单不存在）与异常工时（<=0 / >24）
// 用法：
//   node scripts/migrate-clean-work-hours.js --verify
//   node scripts/migrate-clean-work-hours.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function planCleanup(db) {
  const standard = db.prepare(`SELECT psh.*, pn.id AS node_id
    FROM process_standard_hours psh
    LEFT JOIN process_nodes pn ON CAST(pn.id AS TEXT) = CAST(psh.process_node_id AS TEXT)
    WHERE pn.id IS NULL`).all();
  const orphanReports = db.prepare(`SELECT wr.id, wr.work_order_id, wr.hours_spent
    FROM work_report_details wr
    LEFT JOIN work_orders wo ON wo.id = wr.work_order_id
    WHERE wo.id IS NULL`).all();
  const badHours = db.prepare(`SELECT id, work_order_id, hours_spent FROM work_report_details WHERE hours_spent <= 0 OR hours_spent > 24`).all();
  return { standard, orphanReports, badHours };
}

function applyCleanup(db, plan) {
  const removeStandard = db.prepare("DELETE FROM process_standard_hours WHERE id = ?");
  const removeReport = db.prepare("DELETE FROM work_report_details WHERE id = ?");
  let deleted = 0;
  let deletedReports = 0;
  const tx = db.transaction(() => {
    for (const row of plan.standard) {
      removeStandard.run(row.id);
      deleted += 1;
    }
    for (const row of plan.orphanReports) {
      removeReport.run(row.id);
      deletedReports += 1;
    }
  });
  tx();
  return { deleted, deletedReports };
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const plan = planCleanup(db);
    console.log(`[clean-work-hours] 数据库: ${DB_PATH}`);
    console.log(`孤儿定额行: ${plan.standard.length}`, plan.standard.map((row) => `#${row.id}(node=${row.process_node_id})`).join(" "));
    console.log(`孤儿报工行: ${plan.orphanReports.length}`, plan.orphanReports.map((row) => `#${row.id}(wo=${row.work_order_id})`).join(" "));
    console.log(`异常工时行: ${plan.badHours.length}`, plan.badHours.map((row) => `#${row.id}(${row.hours_spent}h)`).join(" "));
    if (apply) {
      const result = applyCleanup(db, plan);
      console.log(`✅ 删除孤儿定额 ${result.deleted} 行、孤儿报工 ${result.deletedReports} 行（异常工时只报告不自动删除，需人工确认）`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { planCleanup, applyCleanup };
if (require.main === module) main();
