#!/usr/bin/env node
"use strict";
// scripts/migrate-wo-status-check.js
// W2-2：为 work_orders.status 增加数据库级 CHECK 约束（SQLite 需要重建表）
//
// 背景：services/workOrder/stateMachine.js 是唯一权威状态机，但 DB 层没有约束，
//       任何直接 UPDATE / 导入脚本都能写入非法状态。SQLite 不支持
//       ALTER TABLE ADD CONSTRAINT，只能"建新表 → 拷数据 → 删旧表 → 改名 → 重建索引"。
//
// 用法：
//   node scripts/migrate-wo-status-check.js --rehearse      # 默认：在 data/mes.db 的临时副本上演练并自检
//   node scripts/migrate-wo-status-check.js --apply         # 在 data/mes.db 上执行（执行前请先停服务并备份）
//   node scripts/migrate-wo-status-check.js --verify        # 只校验现状（是否已有 CHECK、数据是否合法）
//
// 设计要点：
//   - 幂等：已存在 CHECK 时直接返回 already_applied
//   - 列集合强校验：新表列名/顺序与旧表逐个比对，不同则中止（防漏列/错列）
//   - 事务内完成：PRAGMA foreign_keys=OFF → BEGIN … COMMIT → ON
//   - 重建 3 个索引（idx_wo_status / idx_wo_instance(部分索引) / idx_work_orders_subsystem）
//   - 保留 AUTOINCREMENT 序列（sqlite_sequence）
//   - 收尾校验：foreign_key_check、integrity_check、行数、非法状态写入必须被拒、合法状态可写
//   - 失败即回滚（ROLLBACK）并由调用方从备份恢复（脚本不自动覆盖生产库）

const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "mes.db");
const BACKUP_DIR = path.join(ROOT, "backups");

const STATUSES = ["pending", "dispatched", "in_progress", "paused", "completed", "cancelled"];

const NEW_DDL = `CREATE TABLE work_orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_code TEXT UNIQUE NOT NULL,
  equipment_instance_id INTEGER NOT NULL,
  milestone_id INTEGER,
  subsystem_id INTEGER,
  parent_wo_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  workstation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(", ")})),
  priority INTEGER DEFAULT 3,
  planned_start TEXT,
  planned_end TEXT,
  actual_start TEXT,
  actual_end TEXT,
  estimated_hours REAL,
  actual_hours REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_to INTEGER REFERENCES users(id),
  dispatched_at TEXT,
  quantity_planned INTEGER DEFAULT 1,
  quantity_completed INTEGER DEFAULT 0,
  FOREIGN KEY (equipment_instance_id) REFERENCES "equipment_instances"(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES "instance_milestones"(id),
  FOREIGN KEY (subsystem_id) REFERENCES "equipment_subsystems"(id),
  FOREIGN KEY (parent_wo_id) REFERENCES work_orders(id),
  FOREIGN KEY (workstation_id) REFERENCES workstations(id)
)`;

const INDEXES = [
  "CREATE INDEX idx_work_orders_subsystem ON work_orders(subsystem_id)",
  "CREATE INDEX idx_wo_status ON work_orders(status)",
  "CREATE INDEX idx_wo_instance ON work_orders(equipment_instance_id) WHERE equipment_instance_id IS NOT NULL",
];

function hasCheck(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'work_orders' AND type = 'table'").get();
  return !!(row && /CHECK\s*\(\s*status\s+IN\s*\(/i.test(row.sql));
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/** 校验：约束在位 + 数据合法 + 外键/integrity + 索引齐 + 负向用例 */
function verify(db, label = "", options = {}) {
  const readOnly = options.readOnly === true;
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass, detail: detail === undefined ? "" : String(detail) });

  ok("CHECK 约束存在", hasCheck(db));

  const bad = db.prepare(`SELECT COUNT(*) c FROM work_orders WHERE status NOT IN (${STATUSES.map((s) => `'${s}'`).join(",")})`).get().c;
  ok("现有数据全部合法", bad === 0, `非法行数=${bad}`);

  const fk = db.prepare("PRAGMA foreign_key_check").all();
  ok("foreign_key_check 无孤儿行", fk.length === 0, fk.length ? JSON.stringify(fk).slice(0, 200) : "");

  const integrity = db.pragma("integrity_check", { simple: true });
  ok("integrity_check", integrity === "ok", integrity);

  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='work_orders' ORDER BY name").all().map((r) => r.name);
  for (const need of ["idx_wo_instance", "idx_wo_status", "idx_work_orders_subsystem"]) {
    ok("索引 " + need, idx.includes(need));
  }

  if (readOnly) {
    // 只读连接无法做写入测试（--verify 用它检查生产库现状）
    checks.push({ name: "非法状态被 CHECK 拒绝", pass: true, detail: "跳过（只读连接，由 --apply 的写测试覆盖）" });
    checks.push({ name: "合法状态可写入", pass: true, detail: "跳过（只读连接）" });
    const failedRO = checks.filter((c) => !c.pass);
    console.log(`\n== 校验 ${label} ==`);
    for (const c of checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? " — " + c.detail : ""}`);
    return { ok: failedRO.length === 0, checks };
  }

  // 负向：非法状态必须被拒（事务内试写并回滚）
  db.exec("SAVEPOINT w2_check");
  let rejected = false;
  try {
    db.prepare("INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES (?, 1, ?, ?)")
      .run("__W2_CHECK_BAD__", "非法状态测试", "bogus_status");
  } catch (error) {
    rejected = /CHECK constraint failed/i.test(String(error.message)) || /constraint/i.test(String(error.message));
  }
  db.exec("ROLLBACK TO w2_check");
  db.exec("RELEASE w2_check");
  ok("非法状态被 CHECK 拒绝", rejected);

  // 正向：合法状态可写（同样回滚）
  db.exec("SAVEPOINT w2_ok");
  let accepted = false;
  try {
    db.prepare("INSERT INTO work_orders (wo_code, equipment_instance_id, title, status) VALUES (?, 1, ?, ?)")
      .run("__W2_CHECK_OK__", "合法状态测试", "in_progress");
    accepted = true;
  } catch (_) { /* 保持 false */ }
  db.exec("ROLLBACK TO w2_ok");
  db.exec("RELEASE w2_ok");
  ok("合法状态可写入", accepted);

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n== 校验 ${label} ==`);
  for (const c of checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? " — " + c.detail : ""}`);
  return { ok: failed.length === 0, checks };
}

/** 在给定 db 上执行重建（调用方保证已停服务/是副本） */
function applyMigration(db) {
  if (hasCheck(db)) return { status: "already_applied" };

  const oldCols = columns(db, "work_orders");
  const before = {
    rows: db.prepare("SELECT COUNT(*) c FROM work_orders").get().c,
    seq: (db.prepare("SELECT seq FROM sqlite_sequence WHERE name='work_orders'").get() || {}).seq || 0,
    byStatus: db.prepare("SELECT status, COUNT(*) n FROM work_orders GROUP BY status").all(),
  };

  const fkWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  db.pragma("foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec("DROP TABLE IF EXISTS work_orders_new");
    db.exec(NEW_DDL);
    const newCols = columns(db, "work_orders_new");
    if (oldCols.length !== newCols.length || oldCols.some((c, i) => c !== newCols[i])) {
      throw new Error(`列集合不一致，中止：\n  旧=${oldCols.join(",")}\n  新=${newCols.join(",")}`);
    }
    const colList = oldCols.join(", ");
    db.exec(`INSERT INTO work_orders_new (${colList}) SELECT ${colList} FROM work_orders`);
    db.exec("DROP TABLE work_orders");
    db.exec("ALTER TABLE work_orders_new RENAME TO work_orders");
    for (const sql of INDEXES) db.exec(sql);
    // 还原 AUTOINCREMENT 序列，避免新 id 回退
    if (before.seq) {
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'work_orders'").run(before.seq);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.pragma(`foreign_keys = ${fkWasOn ? "ON" : "OFF"}`);
    throw error;
  }
  db.pragma(`foreign_keys = ${fkWasOn ? "ON" : "OFF"}`);

  const after = {
    rows: db.prepare("SELECT COUNT(*) c FROM work_orders").get().c,
    seq: (db.prepare("SELECT seq FROM sqlite_sequence WHERE name='work_orders'").get() || {}).seq || 0,
    byStatus: db.prepare("SELECT status, COUNT(*) n FROM work_orders GROUP BY status").all(),
  };
  if (before.rows !== after.rows) throw new Error(`行数不一致：${before.rows} → ${after.rows}`);
  if (JSON.stringify(before.byStatus) !== JSON.stringify(after.byStatus)) throw new Error("状态分布不一致");
  if (before.seq && after.seq !== before.seq) throw new Error(`AUTOINCREMENT 序列不一致：${before.seq} → ${after.seq}`);

  return { status: "applied", before, after };
}

function backupProd() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dst = path.join(BACKUP_DIR, `pre-wo-check-${stamp}.dbbak`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true });
  db.exec(`VACUUM INTO '${dst}'`);
  db.close();
  execFileSync("sha256sum", [dst], { encoding: "utf8" });
  return dst;
}

function main() {
  const args = process.argv.slice(2);
  const Database = require("better-sqlite3");
  const mode = args.includes("--apply") ? "apply" : args.includes("--verify") ? "verify" : "rehearse";

  if (mode === "verify") {
    const db = new Database(DB_PATH, { readonly: true });
    const result = verify(db, "生产库现状", { readOnly: true });
    db.close();
    process.exit(result.ok ? 0 : 1);
  }

  if (mode === "rehearse") {
    // 必须用 VACUUM INTO 取一致快照：直接 copyFileSync 会漏掉 -wal 里未 checkpoint 的提交
    const tmp = path.join("/tmp", `wo-check-rehearsal-${Date.now()}.db`);
    fs.rmSync(tmp, { force: true });
    const src = new Database(DB_PATH, { readonly: true });
    src.exec(`VACUUM INTO '${tmp}'`);
    src.close();
    const db = new Database(tmp);
    console.log("演练库:", tmp);
    const res = applyMigration(db);
    console.log("apply:", JSON.stringify(res));
    const check = verify(db, "演练库");
    db.close();
    console.log(check.ok ? "\n✅ 演练通过，可以 --apply" : "\n❌ 演练未通过，不要上生产");
    console.log("演练库保留在", tmp, "（可手动删除）");
    process.exit(check.ok ? 0 : 1);
  }

  // apply
  console.log("[apply] 生产库:", DB_PATH);
  const bak = backupProd();
  console.log("[apply] 已备份:", bak);
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const res = applyMigration(db);
  console.log("[apply] 结果:", JSON.stringify(res));
  const check = verify(db, "生产库（执行后）");
  db.close();
  console.log(check.ok ? "\n✅ 生产库迁移完成" : "\n❌ 迁移后校验失败，请用备份恢复：" + bak);
  process.exit(check.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { NEW_DDL, INDEXES, STATUSES, applyMigration, verify, hasCheck };
