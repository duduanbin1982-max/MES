#!/bin/bash
# scripts/migrate.sh
# 自动跑 db/migrations/ 下所有 .sql (按文件名排序, 已跑的通过 schema_migrations 表跳过)
# 跳过 .sql.废弃 / .sql.bak 等非主分支文件
# 幂等: CREATE TABLE IF NOT EXISTS + 跟踪表去重
set -uo pipefail
ROOT=/home/dubin/factory-mes
NODE=/home/dubin/.nvm/versions/node/v22.22.3/bin/node
export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:$PATH

cd "$ROOT" || exit 1

STATUS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --status) STATUS_ONLY=1 ;;
  esac
done

"$NODE" - << 'EOFNODE'
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const DB_PATH = process.env.MIGRATE_DB_PATH || path.join("/home/dubin/factory-mes/data/mes.db");
const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const dir = process.env.MIGRATE_DIR || "/home/dubin/factory-mes/db/migrations";
const files = fs.readdirSync(dir)
  .filter(f => /^\d{3}_.+\.sql$/.test(f))
  .sort();
const applied = new Set(db.prepare("SELECT filename FROM schema_migrations").all().map(r => r.filename));

const pending = files.filter(f => !applied.has(f));
const skipped = files.filter(f => applied.has(f));

console.log("=== Migration 状态 ===");
console.log("  已应用: " + skipped.length);
skipped.forEach(f => console.log("    [done] " + f));
console.log("  待执行: " + pending.length);
pending.forEach(f => console.log("    [wait] " + f));

if (process.argv.includes("--status")) process.exit(0);

let ok = 0, fail = 0;
for (const f of pending) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  try {
    db.exec("BEGIN");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(f);
    db.exec("COMMIT");
    console.log("  [ok] " + f);
    ok++;
  } catch (e) {
    db.exec("ROLLBACK");
    console.log("  [fail] " + f + " : " + e.message);
    fail++;
  }
}
console.log("\n=== 完成: " + ok + " ok, " + fail + " fail ===");
process.exit(fail > 0 ? 1 : 0);
EOFNODE
