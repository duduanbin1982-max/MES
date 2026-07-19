"use strict";

const TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS service_schema_migrations (
    id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    ddl_statements INTEGER NOT NULL DEFAULT 0,
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
}

function withServiceSchemaVersion(db, serviceName, schemaVersion, registerService) {
  ensureTrackingTable(db);
  const version = Number(schemaVersion || 1);
  const id = `${serviceName}@${version}`;
  const applied = Boolean(db.prepare("SELECT 1 FROM service_schema_migrations WHERE id = ?").get(id));
  const state = { suppress: applied, ddlStatements: 0 };
  const migrationDb = createMigrationDb(db, state);
  const result = registerService(migrationDb);

  if (!applied && state.ddlStatements > 0) {
    db.prepare(`
      INSERT INTO service_schema_migrations (id, service_name, schema_version, ddl_statements)
      VALUES (?, ?, ?, ?)
    `).run(id, serviceName, version, state.ddlStatements);
    state.suppress = true;
  }

  return {
    result,
    status: applied ? "skipped" : state.ddlStatements > 0 ? "applied" : "none",
    ddlStatements: state.ddlStatements,
    id,
  };
}

module.exports = { isDdl, withServiceSchemaVersion };
