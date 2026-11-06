"use strict";
// scripts/migrate-shopfloor-permissions.js
// 2026-11-06（车间工作台审计 SH-2）：新增 shopfloor:write，给现场相关角色补齐
//   worker / welder: shopfloor:write + pick:write（扫码、领料是现场核心动作）
//   foreman / qc: shopfloor:write
// 用法：
//   node scripts/migrate-shopfloor-permissions.js --verify
//   node scripts/migrate-shopfloor-permissions.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

const ROLE_ADDITIONS = {
  worker: ["shopfloor:write", "pick:write", "shopfloor:qc"],
  welder: ["shopfloor:write", "pick:write", "shopfloor:qc"],
  foreman: ["shopfloor:write"],
  qc: ["shopfloor:write"],
};

function planPermissions(db) {
  const rows = db.prepare("SELECT id, role_code, role_name, permissions FROM roles").all();
  return rows.map((row) => {
    let permissions = [];
    try { permissions = JSON.parse(row.permissions || "[]"); } catch (_error) { permissions = []; }
    if (!Array.isArray(permissions)) permissions = [];
    const wanted = ROLE_ADDITIONS[row.role_code] || [];
    const missing = wanted.filter((permission) => !permissions.includes(permission) && !permissions.includes("*"));
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
  const applyMode = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const plan = planPermissions(db);
    console.log(`[shopfloor-permissions] 数据库: ${DB_PATH}`);
    for (const row of plan) console.log(`  - ${row.role_code}: ${row.missing.length ? "补 " + row.missing.join("/") : "已完整"}`);
    if (applyMode) console.log(`✅ 更新 ${applyPlan(db, plan)} 个角色`);
    else console.log("（未执行，加 --apply 生效）");
  } finally { db.close(); }
}

module.exports = { planPermissions, applyPlan, ROLE_ADDITIONS };
if (require.main === module) main();
