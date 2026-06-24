// tests/migrate.test.js
// 验证 scripts/migrate.sh: 幂等 + schema_migrations 表 + 失败回滚
// 通过 MIGRATE_DB_PATH / MIGRATE_DIR 环境变量隔离
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("/home/dubin/factory-mes/node_modules/better-sqlite3");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

function freshDbPath() {
  const p = path.join(os.tmpdir(), "mig-test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".db");
  const db = new Database(p);
  db.close();
  return p;
}

function freshMigDir(files) {
  const dir = path.join(os.tmpdir(), "mig-dir-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql);
  }
  return dir;
}

function runMigrate(dbPath, migDir) {
  const script = "/home/dubin/factory-mes/scripts/migrate.sh";
  try {
    return execFileSync("bash", [script], { encoding: "utf8", timeout: 30000, env: { ...process.env, MIGRATE_DB_PATH: dbPath, MIGRATE_DIR: migDir } });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

test("migrate-1 首次跑全部 OK", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_init.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY, name TEXT);",
    "002_more.sql": "CREATE TABLE t2 (id INTEGER PRIMARY KEY, ref INTEGER);"
  });
  try {
    const out = runMigrate(dbPath, migDir);
    const m = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(m[1], "2", "应跑 2 个");
    assert.equal(m[2], "0", "应 0 失败");
    const db = new Database(dbPath, { readonly: true });
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get().c;
    assert.equal(cnt, 2, "schema_migrations 应记 2 条");
    db.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.rmSync(migDir, { recursive: true }); } catch(e) {}
  }
});

test("migrate-2 二次跑幂等 (0 ok, 不重复)", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_init.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);"
  });
  try {
    runMigrate(dbPath, migDir);
    const out = runMigrate(dbPath, migDir);
    const m = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(m[1], "0", "第二次应 0 ok");
    assert.equal(m[2], "0");
    const db = new Database(dbPath, { readonly: true });
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get().c;
    assert.equal(cnt, 1, "schema_migrations 不应重复");
    db.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.rmSync(migDir, { recursive: true }); } catch(e) {}
  }
});

test("migrate-3 失败事务回滚 (schema_migrations 不记录)", () => {
  const dbPath = freshDbPath();
  const migDir = freshMigDir({
    "001_ok.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);",
    "002_fail.sql": "CREATE TABLE t1 (id INTEGER PRIMARY KEY);"
  });
  try {
    const out = runMigrate(dbPath, migDir);
    const m = out.match(/完成: (\d+) ok, (\d+) fail/);
    assert.equal(m[1], "1", "001 应成功");
    assert.equal(m[2], "1", "002 应失败");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT filename FROM schema_migrations ORDER BY filename").all();
    assert.equal(rows.length, 1, "只有 001 应被记录");
    assert.equal(rows[0].filename, "001_ok.sql");
    db.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.rmSync(migDir, { recursive: true }); } catch(e) {}
  }
});
