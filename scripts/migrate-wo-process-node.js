"use strict";
// scripts/migrate-wo-process-node.js
// 2026-11-05（工单↔工序 1:1 关联）：给 work_orders 增加 process_node_id 列 + 唯一部分索引。
//
// 背景：workOrderService 在 register() 里用 ALTER 兜底新列，但已登记过的服务在 register 阶段
// 会被 serviceMigrations 的 DDL 抑制（schema 已存在），所以存量库要用本脚本一次性补列。
// 本脚本幂等：列/索引已存在时只做校验。
//
// 用法：
//   node scripts/migrate-wo-process-node.js --verify     # 只校验
//   node scripts/migrate-wo-process-node.js --apply      # 执行（建议先停服务并备份）
//   可选 --db <path> 指定库（测试/演练用）
const Database = require("better-sqlite3");
const path = require("node:path");

const DB_FLAG = process.argv.indexOf("--db");
const DB_PATH = DB_FLAG > -1 && process.argv[DB_FLAG + 1]
  ? path.resolve(process.argv[DB_FLAG + 1])
  : path.resolve(__dirname, "..", "data", "mes.db");
const COLUMN = "process_node_id";
const INDEX = "ux_work_orders_process_node";

function columns(db) {
  return new Set(db.prepare("PRAGMA table_info(work_orders)").all().map((row) => row.name));
}

function indexes(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'work_orders'").all().map((row) => row.name));
}

function report(db) {
  const hasColumn = columns(db).has(COLUMN);
  const hasIndex = indexes(db).has(INDEX);
  const linked = hasColumn ? db.prepare("SELECT COUNT(*) AS c FROM work_orders WHERE process_node_id IS NOT NULL").get().c : 0;
  console.log(`work_orders.${COLUMN}: ${hasColumn ? "存在" : "缺失"}`);
  console.log(`唯一索引 ${INDEX}: ${hasIndex ? "存在" : "缺失"}`);
  console.log(`已关联工序的工单: ${linked}`);
  return { hasColumn, hasIndex };
}

function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "verify";
  const db = new Database(DB_PATH);
  try {
    console.log(`[wo-process-node] 数据库: ${DB_PATH}`);
    const before = report(db);
    if (mode === "verify") {
      const ok = before.hasColumn && before.hasIndex;
      console.log(ok ? "✅ 校验通过" : "❌ 尚未迁移（用 --apply 执行）");
      process.exitCode = ok ? 0 : 1;
      return;
    }
    if (!before.hasColumn) {
      db.exec(`ALTER TABLE work_orders ADD COLUMN ${COLUMN} INTEGER REFERENCES process_nodes(id)`);
      console.log(`已新增列 ${COLUMN}`);
    } else {
      console.log("列已存在，跳过 ALTER");
    }
    if (!before.hasIndex) {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON work_orders(${COLUMN}) WHERE ${COLUMN} IS NOT NULL AND status <> 'cancelled'`);
      console.log("已创建唯一部分索引");
    } else {
      console.log("索引已存在，跳过 CREATE INDEX");
    }
    console.log("--- 迁移后 ---");
    const after = report(db);
    console.log(after.hasColumn && after.hasIndex ? "✅ 迁移完成" : "❌ 迁移未完成");
    process.exitCode = after.hasColumn && after.hasIndex ? 0 : 1;
  } finally {
    db.close();
  }
}

main();
