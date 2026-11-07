"use strict";
// scripts/migrate-process-route-upgrade.js
// 2026-11-07 工艺树升级：路线模板/版本/ECN/ITP/执行事件表 + process_nodes 新列
// 用法：node scripts/migrate-process-route-upgrade.js --apply
const path = require("node:path");
const Database = require("better-sqlite3");
const { ensureProcessRouteSchema } = require("../services/processRoute/schema");

const DB_PATH = process.argv.includes("--db")
  ? path.resolve(process.argv[process.argv.indexOf("--db") + 1])
  : path.resolve(__dirname, "..", "data", "mes.db");
const apply = process.argv.includes("--apply");

function main() {
  const db = new Database(DB_PATH);
  try {
    const before = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'process_route%'").get().c;
    if (!apply) {
      console.log(JSON.stringify({ db: DB_PATH, apply: false, route_tables_before: before, message: "加 --apply 执行结构升级" }, null, 2));
      return;
    }
    ensureProcessRouteSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'process_route%' OR name LIKE 'process_itp%' OR name LIKE 'process_operation_events') ORDER BY name").all().map((row) => row.name);
    const columns = db.prepare("PRAGMA table_info(process_nodes)").all().map((row) => row.name).filter((name) => ["route_version_id", "route_template_id", "is_external", "rework_of_node_id", "node_code"].includes(name));
    const templates = db.prepare("SELECT template_code, COUNT(*) steps FROM process_route_templates t LEFT JOIN process_route_template_steps s ON s.template_id = t.id GROUP BY t.id").all();
    console.log(JSON.stringify({ db: DB_PATH, apply: true, tables, columns, templates }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main();
module.exports = { main };
