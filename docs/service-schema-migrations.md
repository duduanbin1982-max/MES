# Service Schema Migrations

Service-owned schema changes are guarded by an explicit version and a generated DDL fingerprint.

- Every entry in `services/registry/*.js` must declare a positive integer `schemaVersion`.
- `db/service-schema-manifest.json` records the static DDL fingerprint for every registered service.
- `services/register-all.js` verifies the manifest before registering a service.
- `db/serviceMigrations.js` stores the applied version and fingerprint in `service_schema_migrations`.
- A previously applied service version is allowed to register routes and seed data, but its DDL is suppressed.
- Reusing the same version with a different fingerprint stops startup instead of silently skipping schema changes.

When service-owned DDL changes:

1. Increment that service's `schemaVersion` in `services/registry/*.js`.
2. Run `npm run schema:write` to regenerate `db/service-schema-manifest.json`.
3. Run `npm run schema:check` and the targeted upgrade test.
4. Commit the service change, registry version and manifest together.

CI compares the current manifest with the parent commit. A changed DDL fingerprint without a version increment fails the build.

Direct unit tests may register a service against an in-memory database. Production route-level schema setup must execute during service registration through `withServiceSchemaVersion`; DDL must never run inside request handlers.
