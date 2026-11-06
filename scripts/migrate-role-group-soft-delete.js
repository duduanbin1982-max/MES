"use strict";
// scripts/migrate-role-group-soft-delete.js
// 2026-11-07（角色组审计 RG-7）：role_groups 增加软删除列
// 用法：
//   node scripts/migrate-role-group-soft-delete.js --verify
//   node scripts/migrate-role-group-soft-delete.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function columns(db) {
  return db.prepare("PRAGMA table_info(role_groups)").all().map((column) => column.name);
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const cols = columns(db);
    const missing = ["deleted_at", "deleted_by"].filter((column) => !cols.includes(column));
    console.log(`[role-group-soft-delete] 数据库: ${DB_PATH}`);
    console.log(`缺失列: ${missing.length ? missing.join(", ") : "无"}`);
    const total = db.prepare("SELECT COUNT(*) c FROM role_groups").get().c;
    console.log(`role_groups 共 ${total} 条`);
    if (apply) {
      if (missing.includes("deleted_at")) db.exec("ALTER TABLE role_groups ADD COLUMN deleted_at TEXT");
      if (missing.includes("deleted_by")) db.exec("ALTER TABLE role_groups ADD COLUMN deleted_by INTEGER");
      console.log("✅ 软删除列已就绪");
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
    console.log("校验:", columns(db).includes("deleted_at") && columns(db).includes("deleted_by") ? "OK" : "FAIL");
  } finally { db.close(); }
}

module.exports = { columns };
if (require.main === module) main();
