"use strict";
// scripts/migrate-work-hours-governance.js
// 2026-11-06（工时与报工遗留 P3 治理）：
//   1) 报工审批流字段：work_report_details.status / approved_by / approved_at / reject_reason
//   2) 月结锁定表：work_month_locks(month PK)
//   3) 工时日历表：work_calendar(date PK, day_type, daily_hours)
//   4) WH-12 历史 worker_id 回填：reported_by → 工单 assigned_to → 工序执行人
// 用法：
//   node scripts/migrate-work-hours-governance.js --verify
//   node scripts/migrate-work-hours-governance.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function planSchema(db) {
  const actions = [];
  if (tableExists(db, "work_report_details")) {
    const columns = tableColumns(db, "work_report_details");
    if (!columns.has("status")) actions.push("ALTER TABLE work_report_details ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
    if (!columns.has("approved_by")) actions.push("ALTER TABLE work_report_details ADD COLUMN approved_by INTEGER");
    if (!columns.has("approved_at")) actions.push("ALTER TABLE work_report_details ADD COLUMN approved_at TEXT");
    if (!columns.has("reject_reason")) actions.push("ALTER TABLE work_report_details ADD COLUMN reject_reason TEXT");
  }
  if (!tableExists(db, "work_month_locks")) {
    actions.push(`CREATE TABLE work_month_locks (
      month TEXT PRIMARY KEY,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by INTEGER,
      note TEXT
    )`);
  }
  if (!tableExists(db, "work_calendar")) {
    actions.push(`CREATE TABLE work_calendar (
      date TEXT PRIMARY KEY,
      day_type TEXT NOT NULL DEFAULT 'workday' CHECK (day_type IN ('workday','weekend','holiday')),
      daily_hours REAL NOT NULL DEFAULT 8,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  return actions;
}

function planWorkerBackfill(db) {
  const rows = db.prepare(`SELECT id, reported_by, process_node_id, work_order_id FROM work_report_details WHERE worker_id IS NULL`).all();
  return rows.map((row) => {
    let workerId = row.reported_by || null;
    if (!workerId && row.work_order_id) {
      const workOrder = db.prepare("SELECT assigned_to FROM work_orders WHERE id=?").get(row.work_order_id);
      workerId = workOrder ? workOrder.assigned_to : null;
    }
    if (!workerId && row.process_node_id) {
      const execution = db.prepare("SELECT operator_id FROM process_executions WHERE process_node_id=? AND operator_id IS NOT NULL ORDER BY timestamp DESC LIMIT 1").get(row.process_node_id);
      workerId = execution ? execution.operator_id : null;
    }
    return { id: row.id, worker_id: workerId };
  });
}

function applyPlan(db, schemaActions, backfillPlan) {
  let schemaChanged = 0;
  for (const sql of schemaActions) {
    db.exec(sql);
    schemaChanged += 1;
  }
  const update = db.prepare("UPDATE work_report_details SET worker_id=? WHERE id=?");
  let backfilled = 0;
  const tx = db.transaction(() => {
    for (const row of backfillPlan) {
      if (!row.worker_id) continue;
      update.run(row.worker_id, row.id);
      backfilled += 1;
    }
  });
  tx();
  return { schemaChanged, backfilled };
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const schemaActions = planSchema(db);
    const backfillPlan = planWorkerBackfill(db);
    console.log(`[work-hours-governance] 数据库: ${DB_PATH}`);
    console.log(`表/列变更 ${schemaActions.length} 项：`);
    for (const sql of schemaActions) console.log("  - " + sql.split("\n")[0]);
    console.log(`worker_id 可回填 ${backfillPlan.filter((row) => row.worker_id).length}/${backfillPlan.length} 条`);
    if (apply) {
      const result = applyPlan(db, schemaActions, backfillPlan);
      console.log(`✅ 执行表/列变更 ${result.schemaChanged} 项，回填 worker_id ${result.backfilled} 条`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
    const after = tableExists(db, "work_report_details")
      ? tableColumns(db, "work_report_details") : new Set();
    console.log("校验: status=" + after.has("status") + " approved_at=" + after.has("approved_at")
      + " work_month_locks=" + tableExists(db, "work_month_locks")
      + " work_calendar=" + tableExists(db, "work_calendar"));
  } finally { db.close(); }
}

module.exports = { planSchema, planWorkerBackfill, applyPlan, tableColumns, tableExists };
if (require.main === module) main();
