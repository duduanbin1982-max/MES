"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const applyPragmas = require("../db/pragmas");

test("applyPragmas applies and verifies production pragmas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mes-pragmas-"));
  const dbPath = path.join(dir, "test.db");
  const db = new Database(dbPath);
  const status = applyPragmas(db);
  assert.equal(status.ok, true);
  assert.deepEqual(status.issues, []);
  assert.equal(status.actual.foreign_keys, 1);
  assert.equal(status.actual.cache_size, -64000);
  assert.equal(status.actual.mmap_size, 268435456);
  assert.equal(status.actual.journal_mode, "wal");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyPragmas reports drift before apply", () => {
  const db = new Database(":memory:");
  const status = applyPragmas.verifyPragmas(db);
  assert.equal(status.ok, false);
  assert.ok(status.issues.length > 0);
  db.close();
});
