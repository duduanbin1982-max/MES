"use strict";
// scripts/migrate-role-group-integrity.js
// 2026-11-06（角色组审计）：
//   · 停用组不应挂用户：对"已停用但仍有用户"的历史组自动恢复启用（避免数据范围继承被停用组截断）
//   · 报告：用户角色与角色组默认角色不一致（建议人工确认）
// 用法：
//   node scripts/migrate-role-group-integrity.js --verify
//   node scripts/migrate-role-group-integrity.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function plan(db) {
  const rows = db.prepare(`
    SELECT rg.id, rg.group_code, rg.group_name, rg.is_active, rg.default_role_code,
           COUNT(u.id) AS user_count
    FROM role_groups rg
    LEFT JOIN users u ON u.role_group_id = rg.id
    GROUP BY rg.id
    ORDER BY rg.id
  `).all();
  const reactivate = rows.filter((group) => !group.is_active && group.user_count > 0);
  const mismatched = db.prepare(`
    SELECT u.id, u.username, u.role_code, rg.group_code, rg.default_role_code
    FROM users u
    JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE rg.default_role_code IS NOT NULL AND u.role_code <> rg.default_role_code
    ORDER BY u.id
  `).all();
  const orphanGroups = rows.filter((group) => group.user_count === 0 && group.is_active);
  return { rows, reactivate, mismatched, orphanGroups };
}

function apply(db, planData) {
  let changed = 0;
  const reactivate = db.prepare("UPDATE role_groups SET is_active = 1, updated_at = datetime('now') WHERE id = ?");
  for (const group of planData.reactivate) {
    reactivate.run(group.id);
    changed += 1;
  }
  return changed;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const planData = plan(db);
    console.log(`[role-group-integrity] 数据库: ${DB_PATH}`);
    console.log(`已停用但仍挂用户的角色组: ${planData.reactivate.length} 条`);
    for (const group of planData.reactivate) console.log(`  - ${group.group_code}（用户数 ${group.user_count}）→ 将恢复启用`);
    console.log(`用户角色与组默认角色不一致: ${planData.mismatched.length} 条`);
    for (const row of planData.mismatched) console.log(`  - ${row.username}: ${row.role_code} vs ${row.group_code}(${row.default_role_code})`);
    console.log(`启用但无用户的角色组: ${planData.orphanGroups.length} 条: ${planData.orphanGroups.map((group) => group.group_code).join(", ")}`);
    if (applyMode) {
      const changed = apply(db, planData);
      console.log(`✅ 已恢复启用 ${changed} 个角色组`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { plan, apply };
if (require.main === module) main();
