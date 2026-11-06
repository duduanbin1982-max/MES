"use strict";
// scripts/migrate-user-governance.js
// 2026-11-06（用户管理审计）：
//   · users.token_version —— 禁用/改角色/改密码/角色权限变更后 +1，旧 JWT 立即失效
// 用法：
//   node scripts/migrate-user-governance.js --verify
//   node scripts/migrate-user-governance.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function columns(db) {
  return db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const cols = columns(db);
    const missing = !cols.includes("token_version");
    console.log(`[user-governance] 数据库: ${DB_PATH}`);
    console.log(`users.token_version: ${missing ? "缺失（将新增，默认 0）" : "已存在"}`);
    const activeAdmins = db.prepare("SELECT COUNT(*) c FROM users WHERE role_code='admin' AND is_active=1").get().c;
    const total = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    console.log(`用户总数 ${total}，启用管理员 ${activeAdmins}`);
    if (apply && missing) {
      db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
      console.log("✅ 已新增 users.token_version（现有用户默认为 0，旧 token 仍有效直至下次变更/过期）");
    } else if (!missing) {
      console.log("（无需变更）");
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
    console.log("校验:", columns(db).includes("token_version") ? "OK" : "FAIL");
  } finally { db.close(); }
}

module.exports = { columns };
if (require.main === module) main();
