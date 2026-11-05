"use strict";
// scripts/migrate-acceptance-unify.js
// 2026-11-05（DLV-6 双验收表统一）：
//   · acceptance_checklists（旧）→ acceptance_records（新），acceptance_no = AC-LEGACY-<id>
//   · checklist_name/items 以 CHECKLIST: JSON 写入 notes（与 unified 端点一致）
//   · 旧表行标记 status='archived'，只读保留审计
// 用法：
//   node scripts/migrate-acceptance-unify.js --verify
//   node scripts/migrate-acceptance-unify.js --apply
const Database = require("better-sqlite3");
const path = require("node:path");
const { encodeChecklist } = require("../services/tbmAdvanced/acceptance");

const FLAG_DB = process.argv.indexOf("--db");
const DB_PATH = FLAG_DB > -1 && process.argv[FLAG_DB + 1] ? path.resolve(process.argv[FLAG_DB + 1]) : path.resolve(__dirname, "..", "data", "mes.db");

const RESULT_MAP = { pending: "pending", passed: "passed", conditional: "conditional", rejected: "rejected", failed: "rejected" };

function planMigration(db) {
  const rows = db.prepare("SELECT * FROM acceptance_checklists").all();
  return rows.map((row) => ({
    legacyId: row.id,
    acceptanceNo: "AC-LEGACY-" + row.id,
    migrated: Boolean(db.prepare("SELECT id FROM acceptance_records WHERE acceptance_no = ?").get("AC-LEGACY-" + row.id)),
    payload: {
      equipment_instance_id: row.equipment_instance_id,
      acceptance_type: "fat",
      result: RESULT_MAP[row.result] || "pending",
      condition_note: row.issues || null,
      customer_name: row.customer_rep || null,
      signer_name: row.inspector || null,
      signed_at: row.sign_date || null,
      actual_date: row.sign_date ? String(row.sign_date).slice(0, 10) : null,
      notes: encodeChecklist(row.checklist_name, safeItems(row.items)),
    },
  }));
}

function safeItems(items) {
  try { const parsed = JSON.parse(items || "[]"); return Array.isArray(parsed) ? parsed : []; } catch (_error) { return []; }
}

function applyMigration(db, plan) {
  const insert = db.prepare(`INSERT INTO acceptance_records
    (acceptance_no, equipment_instance_id, acceptance_type, result, condition_note, customer_name, signer_name, signed_at, actual_date, notes)
    VALUES (@acceptance_no, @equipment_instance_id, @acceptance_type, @result, @condition_note, @customer_name, @signer_name, @signed_at, @actual_date, @notes)`);
  const archive = db.prepare("UPDATE acceptance_checklists SET status='archived', updated_at=datetime('now') WHERE id=?");
  let count = 0;
  const tx = db.transaction(() => {
    for (const item of plan) {
      if (item.migrated) { archive.run(item.legacyId); continue; }
      insert.run(Object.assign({ acceptance_no: item.acceptanceNo }, item.payload));
      archive.run(item.legacyId);
      count += 1;
    }
  });
  tx();
  return count;
}

function main() {
  const apply = process.argv.includes("--apply");
  const db = new Database(DB_PATH);
  try {
    const plan = planMigration(db);
    console.log(`[acceptance-unify] 数据库: ${DB_PATH}`);
    console.log(`旧表 ${plan.length} 条：已迁移 ${plan.filter((row) => row.migrated).length}，待迁移 ${plan.filter((row) => !row.migrated).length}`);
    for (const row of plan) console.log(`  - #${row.legacyId} → ${row.acceptanceNo}${row.migrated ? "（已存在）" : ""}`);
    if (apply) console.log(`✅ 迁移 ${applyMigration(db, plan)} 条`);
    else console.log("（未执行，加 --apply 生效）");
    const remaining = db.prepare("SELECT COUNT(*) AS c FROM acceptance_checklists WHERE status <> 'archived'").get().c;
    console.log(`旧表未归档行: ${remaining}`);
  } finally { db.close(); }
}

module.exports = { planMigration, applyMigration, safeItems };

if (require.main === module) main();
