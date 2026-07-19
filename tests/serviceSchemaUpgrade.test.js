"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "service-schema-upgrade-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const express = require("express");
const { registerAll } = require("../services/register-all");

test("numbered migrations upgrade into a fully registered service schema", () => {
  const dbPath = path.join(os.tmpdir(), `mes-schema-upgrade-${process.pid}-${Date.now()}.db`);
  try {
    childProcess.execFileSync("bash", [path.resolve(__dirname, "../scripts/migrate.sh")], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, MIGRATE_DB_PATH: dbPath },
    });

    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    registerAll(express(), db);

    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const migrationState = db.prepare(`
      SELECT COUNT(*) AS count,
             SUM(CASE WHEN ddl_fingerprint IS NULL THEN 1 ELSE 0 END) AS missing_fingerprints
      FROM service_schema_migrations
    `).get();
    assert.ok(migrationState.count > 0);
    assert.equal(migrationState.missing_fingerprints, 0);
    const tableCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get().count;
    assert.ok(tableCount > 100, `expected full MES schema, received ${tableCount} tables`);
    db.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (_error) {}
  }
});
