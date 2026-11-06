"use strict";
// scripts/migrate-role-group-cleanup.js
// 2026-11-06（角色与权限 P3）：
//   · 创建 permission_change_requests 表（权限矩阵变更双人复核）
//   · 停用历史冗余角色组（planner / administrator，无用户归属）而非直接删除：
//     先停用保证可逆；确认无用后可由新 DELETE /api/role-groups/:id 彻底删除
// 用法：
//   node scripts/migrate-role-group-cleanup.js --verify
//   node scripts/migrate-role-group-cleanup.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");
const HISTORICAL_GROUPS = new Set(["planner", "administrator"]);

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function plan(db) {
  const requestsTable = tableExists(db, "permission_change_requests");
  const groups = db.prepare(`
    SELECT rg.*, (SELECT COUNT(*) FROM users u WHERE u.role_group_id = rg.id) AS user_count
    FROM role_groups rg ORDER BY rg.id
  `).all();
  const toDeactivate = groups.filter((group) => HISTORICAL_GROUPS.has(group.group_code) && group.is_active && group.user_count === 0);
  const emptyGroups = groups.filter((group) => group.user_count === 0);
  return { requestsTable, groups, toDeactivate, emptyGroups };
}

function apply(db, planData) {
  let changed = 0;
  db.exec(`CREATE TABLE IF NOT EXISTS permission_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_code TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    requested_by INTEGER,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    review_note TEXT
  )`);
  const deactivate = db.prepare("UPDATE role_groups SET is_active = 0, updated_at = datetime('now') WHERE id = ?");
  for (const group of planData.toDeactivate) {
    deactivate.run(group.id);
    changed += 1;
  }
  return changed;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const planData = plan(db);
    console.log(`[role-group-cleanup] 数据库: ${DB_PATH}`);
    console.log(`permission_change_requests 表: ${planData.requestsTable ? "已存在" : "缺失（将创建）"}`);
    console.log(`历史冗余角色组待停用: ${planData.toDeactivate.length} 条`);
    for (const group of planData.toDeactivate) console.log(`  - ${group.group_code}（${group.group_name}，用户数 ${group.user_count}）`);
    console.log(`空角色组（无用户）: ${planData.emptyGroups.length} 条: ${planData.emptyGroups.map((group) => group.group_code).join(", ")}`);
    if (applyMode) {
      const changed = apply(db, planData);
      console.log(`✅ 已创建审批表，停用历史冗余角色组 ${changed} 条（可逆：is_active=0）`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { plan, apply, HISTORICAL_GROUPS };
if (require.main === module) main();
