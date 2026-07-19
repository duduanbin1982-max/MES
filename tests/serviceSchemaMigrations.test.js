"use strict";

require("dotenv").config({ quiet: true });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "service-schema-test-only-secret-value";
}

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { SERVICES } = require("../services/registry");
const { withServiceSchemaVersion } = require("../db/serviceMigrations");
const { validateVersionBumps } = require("../scripts/check-service-schema-versions");

test("every registered service declares an explicit schema version", () => {
  assert.ok(SERVICES.length > 0);
  for (const service of SERVICES) {
    assert.equal(Number.isInteger(service.schemaVersion), true, service.name);
    assert.ok(service.schemaVersion > 0, service.name);
  }
});

test("service schema migrations run once and rerun only after a version bump", () => {
  const db = new Database(":memory:");
  let registrations = 0;
  const register = (migrationDb) => {
    registrations += 1;
    migrationDb.exec("CREATE TABLE IF NOT EXISTS guarded_schema (id INTEGER PRIMARY KEY, value TEXT)");
    migrationDb.prepare("ALTER TABLE guarded_schema ADD COLUMN note TEXT").run();
  };

  const first = withServiceSchemaVersion(db, "guarded-service", 1, "fingerprint-v1", register);
  const second = withServiceSchemaVersion(db, "guarded-service", 1, "fingerprint-v1", register);
  const upgraded = withServiceSchemaVersion(db, "guarded-service", 2, "fingerprint-v2", (migrationDb) => {
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

test("same service version rejects a changed DDL fingerprint", () => {
  const db = new Database(":memory:");
  const register = (migrationDb) => migrationDb.exec("CREATE TABLE guarded_schema (id INTEGER PRIMARY KEY)");
  withServiceSchemaVersion(db, "guarded-service", 1, "fingerprint-v1", register);

  assert.throws(
    () => withServiceSchemaVersion(db, "guarded-service", 1, "fingerprint-changed", register),
    /DDL fingerprint changed/
  );
  db.close();
});

test("legacy migration records receive a fingerprint without rerunning DDL", () => {
  const db = new Database(":memory:");
  const register = (migrationDb) => migrationDb.exec("CREATE TABLE guarded_schema (id INTEGER PRIMARY KEY)");
  withServiceSchemaVersion(db, "guarded-service", 1, null, register);
  const second = withServiceSchemaVersion(db, "guarded-service", 1, "fingerprint-v1", register);

  assert.equal(second.status, "skipped");
  assert.equal(
    db.prepare("SELECT ddl_fingerprint FROM service_schema_migrations WHERE id = ?").get("guarded-service@1").ddl_fingerprint,
    "fingerprint-v1"
  );
  db.close();
});

test("missing schema versions fail before service registration", () => {
  const db = new Database(":memory:");
  assert.throws(
    () => withServiceSchemaVersion(db, "guarded-service", undefined, null, () => {}),
    /positive integer schemaVersion/
  );
  db.close();
});

test("DDL manifest drift requires a greater service schema version", () => {
  const previous = {
    services: { traceService: { schemaVersion: 1, ddlFingerprint: "before" } },
  };
  const unchangedVersion = {
    services: { traceService: { schemaVersion: 1, ddlFingerprint: "after" } },
  };
  const upgradedVersion = {
    services: { traceService: { schemaVersion: 2, ddlFingerprint: "after" } },
  };

  assert.equal(validateVersionBumps(previous, unchangedVersion).length, 1);
  assert.deepEqual(validateVersionBumps(previous, upgradedVersion), []);
});
