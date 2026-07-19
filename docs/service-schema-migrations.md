# Service Schema Migrations

Service-owned schema changes are versioned at the service composition root.

- `services/registry/*.js` identifies a service by `name` and optional `schemaVersion`.
- `services/register-all.js` runs registration through `db/serviceMigrations.js`.
- The first registration of `serviceName@schemaVersion` may execute DDL and records it in `service_schema_migrations`.
- Later starts still register routes and seed data, but repeated DDL for that version is suppressed.
- Increase `schemaVersion` whenever a service adds or changes schema DDL.
- Direct unit tests may register a service against an in-memory database without the production guard.

Route-level schema setup must run during route registration through `withServiceSchemaVersion`; it must not execute inside request handlers.
