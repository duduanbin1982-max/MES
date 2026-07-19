CREATE TABLE IF NOT EXISTS service_schema_migrations (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  ddl_statements INTEGER NOT NULL DEFAULT 0,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_schema_migrations_service
  ON service_schema_migrations(service_name, schema_version);
