// tests/migrate.test.js
// 验证 scripts/migrate.sh: 幂等 + schema_migrations 表 + 失败回滚
// 通过 MIGRATE_DB_PATH / MIGRATE_DIR 环境变量隔离
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("/home/dubin/factory-mes/node_modules/better-sqlite3");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function freshDbPath() {
  const file = path.join(os.tmpdir(), "mig-test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".db");
  const db = new Database(file);
  db.close();
  return file;
}

function freshMigDir(files) {
  const dir = path.join(os.tmpdir(), "mig-dir-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

function runMigrate(dbPath, migDir, args = []) {
  const script = "/home/dubin/factory-mes/scripts/migrate.sh";
  try {
    return execFileSync("bash", [script, ...args], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, MIGRATE_DB_PATH: dbPath, MIGRATE_DIR: migDir },
    });
  } catch (error) {
    return (error.stdout || "") + (error.stderr || "");
  }
}

function cleanup(dbPath, migDir) {
  try { fs.unlinkSync(dbPath); } catch (_error) {}
  try { fs.rmSync(migDir, { recursive: true }); } catch (_error) {}
}

test("migrate-1 首次跑全部 OK", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_init.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY, name TEXT);",
    "002_more.sql": "CREATE TABLE t2 (id INTEGER PRIMARY KEY, ref INTEGER);",
  });
  try {
    const out = runMigrate(dbPath, migDir);
    const match = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(match[1], "2", "应跑 2 个");
    assert.equal(match[2], "0", "应 0 失败");
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});

test("migrate-2 二次跑幂等", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({ "001_init.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);" });
  try {
    runMigrate(dbPath, migDir);
    const out = runMigrate(dbPath, migDir);
    const match = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(match[1], "0");
    assert.equal(match[2], "0");
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 1);
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});

test("migrate-3 失败事务回滚", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_ok.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
    "002_fail.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
  });
  try {
    const out = runMigrate(dbPath, migDir);
    const match = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(match[1], "1");
    assert.equal(match[2], "1");
    const db = new Database(dbPath, { readonly: true });
    assert.deepEqual(db.prepare("SELECT filename FROM schema_migrations ORDER BY filename").all(), [{ filename: "001_ok.sql" }]);
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});

test("migrate-4 兼容自带事务的历史迁移", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_wrapped.sql": `
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      CREATE TABLE t1 (id INTEGER PRIMARY KEY);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `,
  });
  try {
    const out = runMigrate(dbPath, migDir);
    assert.match(out, /完成: 1 ok, 0 fail/);
    const db = new Database(dbPath, { readonly: true });
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 't1'").get());
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});

test("migrate-5 ensure-column 指令可重复升级旧库", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_base.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
    "002_column.sql": "-- @ensure-column t1 note TEXT",
  });
  try {
    const out = runMigrate(dbPath, migDir);
    assert.match(out, /完成: 2 ok, 0 fail/);
    const db = new Database(dbPath, { readonly: true });
    assert.ok(db.prepare("PRAGMA table_info(t1)").all().some((column) => column.name === "note"));
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});

test("migrate-6 status 不执行待迁移文件", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({ "001_init.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);" });
  try {
    const out = runMigrate(dbPath, migDir, ["--status"]);
    assert.match(out, /待执行: 1/);
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 't1'").get(), undefined);
    db.close();
  } finally {
    cleanup(dbPath, migDir);
  }
});
