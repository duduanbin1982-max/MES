#!/bin/bash
# scripts/migrate.sh
# 自动跑 db/migrations/ 下所有 .sql (按文件名排序, 已跑的通过 schema_migrations 表跳过)
set -uo pipefail
ROOT=/home/dubin/factory-mes
NODE=/home/dubin/.nvm/versions/node/v22.22.3/bin/node
export PATH=/home/dubin/.nvm/versions/node/v22.22.3/bin:$PATH

cd "$ROOT" || exit 1

"$NODE" - "$@" << 'EOFNODE'
const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");

const DB_PATH = process.env.MIGRATE_DB_PATH || path.join("/home/dubin/factory-mes/data/mes.db");
const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const dir = process.env.MIGRATE_DIR || "/home/dubin/factory-mes/db/migrations";
const files = fs.readdirSync(dir)
  .filter((file) => /^\d{3}_.+\.sql$/.test(file))
  .sort();
const applied = new Set(db.prepare("SELECT filename FROM schema_migrations").all().map((row) => row.filename));
const pending = files.filter((file) => !applied.has(file));
const skipped = files.filter((file) => applied.has(file));

console.log("=== Migration 状态 ===");
console.log("  已应用: " + skipped.length);
skipped.forEach((file) => console.log("    [done] " + file));
console.log("  待执行: " + pending.length);
pending.forEach((file) => console.log("    [wait] " + file));

if (process.argv.includes("--status")) {
  db.close();
  process.exit(0);
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid identifier: ${value}`);
  return `"${value}"`;
}

function expandDirectives(sql) {
  return sql.replace(
    /^\s*--\s*@ensure-column\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/gim,
    (_line, table, column, definition) => {
      const exists = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
        .some((item) => item.name === column);
      if (exists) return "";
      return `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition.trim()};`;
    }
  );
}

function prepareSql(source) {
  return expandDirectives(source)
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;\s*$/gim, "")
    .replace(/^\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK)\s*;\s*$/gim, "");
}

let ok = 0;
let fail = 0;
for (const file of pending) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  const disableForeignKeys = /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(source);
  const sql = prepareSql(source);
  const foreignKeysWereEnabled = db.pragma("foreign_keys", { simple: true }) === 1;
  try {
    if (disableForeignKeys && foreignKeysWereEnabled) db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(file);
    }).immediate();
    console.log("  [ok] " + file);
    ok += 1;
  } catch (error) {
    console.log("  [fail] " + file + " : " + error.message);
    fail += 1;
  } finally {
    if (disableForeignKeys && foreignKeysWereEnabled) db.pragma("foreign_keys = ON");
  }
}

console.log("\n=== 完成: " + ok + " ok, " + fail + " fail ===");
db.close();
process.exit(fail > 0 ? 1 : 0);
EOFNODE
