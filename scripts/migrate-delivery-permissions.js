"use strict";
// scripts/migrate-delivery-permissions.js
// 2026-11-05（DLV-7 权限细分）：给存量角色补 delivery:read/write。
//   · admin（*）跳过
//   · planner/foreman/production_supervisor：delivery:read + delivery:write
//   · 其它业务角色（sales/engineer/qc/worker/welder/purchaser/warehouse）：delivery:read
// 用法：
//   node scripts/migrate-delivery-permissions.js --verify
//   node scripts/migrate-delivery-permissions.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

const WRITE_ROLES = new Set(["planner", "foreman", "production_supervisor"]);
const READ_ROLES = new Set(["planner", "foreman", "production_supervisor", "sales", "engineer", "qc", "worker", "welder", "purchaser", "warehouse"]);

function planPermissions(db) {
  const rows = db.prepare("SELECT id, role_code, role_name, permissions FROM roles").all();
  return rows.map((row) => {
    let permissions = [];
    try { permissions = JSON.parse(row.permissions || "[]"); } catch (_error) { permissions = []; }
    if (!Array.isArray(permissions)) permissions = [];
    const additions = [];
    if (WRITE_ROLES.has(row.role_code)) additions.push("delivery:read", "delivery:write");
    else if (READ_ROLES.has(row.role_code)) additions.push("delivery:read");
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
    console.log(`[delivery-permissions] 数据库: ${DB_PATH}`);
    for (const row of plan) console.log(`  - ${row.role_code}: ${row.missing.length ? "补 " + row.missing.join("/") : "已完整"}`);
    if (apply) console.log(`✅ 更新 ${applyPlan(db, plan)} 个角色`);
    else console.log("（未执行，加 --apply 生效）");
  } finally { db.close(); }
}

module.exports = { planPermissions, applyPlan, READ_ROLES, WRITE_ROLES };

if (require.main === module) main();
