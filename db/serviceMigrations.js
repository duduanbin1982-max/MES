"use strict";

const TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS service_schema_migrations (
    id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    ddl_statements INTEGER NOT NULL DEFAULT 0,
    ddl_fingerprint TEXT,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function isDdl(sql) {
  return /(?:^|;)\s*(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER|VIEW)\b/im.test(String(sql || ""));
}

function skippedStatement() {
  const statement = {
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    get: () => undefined,
    all: () => [],
    iterate: function* iterate() {},
    columns: () => [],
    bind: () => statement,
    pluck: () => statement,
    expand: () => statement,
    raw: () => statement,
    safeIntegers: () => statement,
  };
  return statement;
}

function createMigrationDb(db, state) {
  return new Proxy(db, {
    get(target, property) {
      if (property === "exec") {
        return (sql) => {
          if (isDdl(sql)) {
            state.ddlStatements += 1;
            if (state.suppress) return target;
          }
          return target.exec(sql);
        };
      }
      if (property === "prepare") {
        return (sql) => {
          if (isDdl(sql)) {
            state.ddlStatements += 1;
            if (state.suppress) return skippedStatement();
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function ensureTrackingTable(db) {
  db.exec(TRACKING_TABLE_SQL);
  const columns = new Set(db.prepare("PRAGMA table_info(service_schema_migrations)").all().map((column) => column.name));
  if (!columns.has("ddl_fingerprint")) {
    db.exec("ALTER TABLE service_schema_migrations ADD COLUMN ddl_fingerprint TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_service_schema_migrations_service
    ON service_schema_migrations(service_name, schema_version)
  `);
}

function assertSchemaVersion(serviceName, schemaVersion) {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`[service-schema] ${serviceName} must declare a positive integer schemaVersion`);
  }
}

function withServiceSchemaVersion(db, serviceName, schemaVersion, schemaFingerprint, registerService) {
  if (!serviceName || typeof serviceName !== "string") {
    throw new Error("[service-schema] serviceName is required");
  }
  assertSchemaVersion(serviceName, schemaVersion);
  if (typeof registerService !== "function") {
    throw new Error(`[service-schema] ${serviceName} registerService must be a function`);
  }

  ensureTrackingTable(db);
  const id = `${serviceName}@${schemaVersion}`;
  const existing = db.prepare(`
    SELECT id, ddl_fingerprint
    FROM service_schema_migrations
    WHERE id = ?
  `).get(id);

  if (existing?.ddl_fingerprint && existing.ddl_fingerprint !== schemaFingerprint) {
    throw new Error(
      `[service-schema] ${serviceName}@${schemaVersion} DDL fingerprint changed; increment schemaVersion and regenerate the manifest`
    );
  }
  if (existing && !existing.ddl_fingerprint && schemaFingerprint) {
    db.prepare("UPDATE service_schema_migrations SET ddl_fingerprint = ? WHERE id = ?")
      .run(schemaFingerprint, id);
  }

  const state = { suppress: Boolean(existing), ddlStatements: 0 };
  const result = registerService(createMigrationDb(db, state));

  if (!existing && state.ddlStatements > 0) {
    db.prepare(`
      INSERT INTO service_schema_migrations
        (id, service_name, schema_version, ddl_statements, ddl_fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, serviceName, schemaVersion, state.ddlStatements, schemaFingerprint || null);
  }

  return {
    result,
    status: existing ? "skipped" : state.ddlStatements > 0 ? "applied" : "none",
    ddlStatements: state.ddlStatements,
    id,
  };
}

module.exports = { assertSchemaVersion, isDdl, withServiceSchemaVersion };
