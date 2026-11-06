"use strict";
// scripts/migrate-work-report-permissions.js
// 2026-11-06（工时与报工审计 WH-2）：新增 work_report:read / work_report:write 并同步存量角色。
//   · planner / foreman / production_supervisor / worker / welder：read + write
//   · qc / engineer：read
// 用法：
//   node scripts/migrate-work-report-permissions.js --verify
//   node scripts/migrate-work-report-permissions.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

const WRITE_ROLES = new Set(["planner", "foreman", "production_supervisor", "worker", "welder"]);
const READ_ROLES = new Set(["planner", "foreman", "production_supervisor", "worker", "welder", "qc", "engineer"]);

function planPermissions(db) {
  const rows = db.prepare("SELECT id, role_code, role_name, permissions FROM roles").all();
  return rows.map((row) => {
    let permissions = [];
    try { permissions = JSON.parse(row.permissions || "[]"); } catch (_error) { permissions = []; }
    if (!Array.isArray(permissions)) permissions = [];
    const additions = [];
    if (WRITE_ROLES.has(row.role_code)) additions.push("work_report:read", "work_report:write");
    else if (READ_ROLES.has(row.role_code)) additions.push("work_report:read");
    const missing = additions.filter((permission) => !permissions.includes(permission) && !permissions.includes("*"));
    return { role_code: row.role_code, id: row.id, missing, next: [...permissions, ...missing] };
  });
}

function applyPlan(db, plan) {
  const update = db.prepare("UPDATE roles SET permissions = ? WHERE id = ?");
  let changed = 0;
  const tx = db.transaction(() => {
    for (const row of plan) {
      if (!row.missing.length) continue;
      update.run(JSON.stringify(row.next), row.id);
      changed += 1;
    }
  });
  tx();
  return changed;
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const plan = planPermissions(db);
    console.log(`[work-report-permissions] 数据库: ${DB_PATH}`);
    for (const row of plan) console.log(`  - ${row.role_code}: ${row.missing.length ? "补 " + row.missing.join("/") : "已完整"}`);
    if (apply) console.log(`✅ 更新 ${applyPlan(db, plan)} 个角色`);
    else console.log("（未执行，加 --apply 生效）");
  } finally { db.close(); }
}

module.exports = { planPermissions, applyPlan, READ_ROLES, WRITE_ROLES };
if (require.main === module) main();
