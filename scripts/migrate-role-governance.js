"use strict";
// scripts/migrate-role-governance.js
// 2026-11-06（角色与权限审计）：
//   · 修复 admin 角色缺失 '*'（防止权限矩阵把系统锁死）
//   · 规范化 role_groups.group_code（小写字母开头，非法字符转下划线，冲突加后缀）
//   · 报告角色权限码不在目录中的项（只报告，不自动删）
// 用法：
//   node scripts/migrate-role-governance.js --verify
//   node scripts/migrate-role-governance.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");
const { PERMISSIONS } = require("../app/permissions");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

function suggestedGroupCode(raw) {
  let code = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!code) code = "group";
  if (!/^[a-z]/.test(code)) code = "group_" + code;
  return code.slice(0, 32);
}

function plan(db) {
  const admin = db.prepare("SELECT id, permissions FROM roles WHERE role_code='admin'").get();
  let adminPerms;
  try { adminPerms = JSON.parse(admin.permissions || "[]"); } catch (_error) { adminPerms = []; }
  const adminNeedsStar = !adminPerms.includes("*");

  const groups = db.prepare("SELECT id, group_code FROM role_groups ORDER BY id").all();
  const used = new Set(groups.map((row) => row.group_code));
  const renames = [];
  for (const group of groups) {
    if (/^[a-z][a-z0-9_]{1,31}$/.test(group.group_code)) continue;
    let next = suggestedGroupCode(group.group_code);
    if (used.has(next)) {
      let suffix = 2;
      while (used.has(next + "_" + suffix)) suffix += 1;
      next = next + "_" + suffix;
    }
    used.add(next);
    renames.push({ id: group.id, from: group.group_code, to: next });
  }

  const known = new Set(Object.keys(PERMISSIONS));
  const resources = new Set([...known].map((code) => code.split(":")[0]));
  const unknownPermissions = [];
  for (const role of db.prepare("SELECT role_code, permissions FROM roles").all()) {
    let permissions;
    try { permissions = JSON.parse(role.permissions || "[]"); } catch (_error) { permissions = []; }
    for (const code of permissions) {
      if (code === "*") continue;
      if (code.endsWith(":*")) {
        if (!resources.has(code.slice(0, -2))) unknownPermissions.push({ role: role.role_code, code });
        continue;
      }
      if (!known.has(code)) unknownPermissions.push({ role: role.role_code, code });
    }
  }
  return { adminNeedsStar, renames, unknownPermissions };
}

function apply(db, planData) {
  let changed = 0;
  if (planData.adminNeedsStar) {
    const role = db.prepare("SELECT permissions FROM roles WHERE role_code='admin'").get();
    let permissions;
    try { permissions = JSON.parse(role.permissions || "[]"); } catch (_error) { permissions = []; }
    permissions = ["*", ...permissions.filter((code) => code !== "*")];
    db.prepare("UPDATE roles SET permissions=? WHERE role_code='admin'").run(JSON.stringify(permissions));
    changed += 1;
  }
  const rename = db.prepare("UPDATE role_groups SET group_code=? WHERE id=?");
  for (const row of planData.renames) {
    rename.run(row.to, row.id);
    changed += 1;
  }
  return changed;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const planData = plan(db);
    console.log(`[role-governance] 数据库: ${DB_PATH}`);
    console.log(`admin 缺少 * 超级权限: ${planData.adminNeedsStar ? "是（需修复）" : "否"}`);
    console.log(`role_groups 编码需规范化: ${planData.renames.length} 条`);
    for (const row of planData.renames) console.log(`  - ${row.from} -> ${row.to}`);
    console.log(`未知权限码: ${planData.unknownPermissions.length} 项`);
    for (const row of planData.unknownPermissions) console.log(`  - ${row.role}: ${row.code}`);
    if (applyMode) {
      const changed = apply(db, planData);
      console.log(`✅ 已修复 ${changed} 项（admin 权限 / role_groups 编码）`);
    } else {
      console.log("（未执行，加 --apply 生效）");
    }
  } finally { db.close(); }
}

module.exports = { plan, apply, suggestedGroupCode };
if (require.main === module) main();
