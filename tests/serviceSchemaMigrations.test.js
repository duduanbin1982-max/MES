"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { withServiceSchemaVersion } = require("../db/serviceMigrations");

test("service schema migrations run once and rerun only after a version bump", () => {
  const db = new Database(":memory:");
  let registrations = 0;
  const register = (migrationDb) => {
    registrations += 1;
    migrationDb.exec("CREATE TABLE IF NOT EXISTS guarded_schema (id INTEGER PRIMARY KEY, value TEXT)");
    migrationDb.prepare("ALTER TABLE guarded_schema ADD COLUMN note TEXT").run();
  };

  const first = withServiceSchemaVersion(db, "guarded-service", 1, register);
  const second = withServiceSchemaVersion(db, "guarded-service", 1, register);
  const upgraded = withServiceSchemaVersion(db, "guarded-service", 2, (migrationDb) => {
    registrations += 1;
    migrationDb.prepare("ALTER TABLE guarded_schema ADD COLUMN version_two TEXT").run();
  });

  assert.equal(first.status, "applied");
  assert.equal(second.status, "skipped");
  assert.equal(upgraded.status, "applied");
  assert.equal(registrations, 3, "route/service registration still runs on every startup");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_schema_migrations").get().count, 2);
  assert.ok(db.prepare("PRAGMA table_info(guarded_schema)").all().some((column) => column.name === "version_two"));
  db.close();
});
