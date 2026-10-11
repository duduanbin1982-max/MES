"use strict";
// services/register-all.js
// Explicit service composition root. The registry is a deliberate API surface:
// a service is mounted only when listed in services/registry.js.

const schemaManifest = require("../db/service-schema-manifest.json");
const { withServiceSchemaVersion } = require("../db/serviceMigrations");
const { SERVICES } = require("./registry");

const logger = require("../app/logger").createLogger("register-all");

function registerAll(app, db) {
  for (const entry of SERVICES) {
    const mod = require(entry.module);
    if (!mod || typeof mod.register !== "function") {
      throw new Error(`[register-all] ${entry.name} does not export register(app, db)`);
    }
    const schema = schemaManifest.services[entry.name];
    if (!schema || schema.schemaVersion !== entry.schemaVersion) {
      throw new Error(`[register-all] schema manifest is stale for ${entry.name}; run npm run schema:write`);
    }
    const migration = withServiceSchemaVersion(
      db,
      entry.name,
      entry.schemaVersion,
      schema.ddlFingerprint,
      (serviceDb) => {
        if (Object.prototype.hasOwnProperty.call(entry, "deps")) return mod.register(app, serviceDb, entry.deps);
        return mod.register(app, serviceDb);
      }
    );
    logger.info("[register-all]", entry.name, `schema=${migration.status}`, Object.prototype.hasOwnProperty.call(entry, "deps") ? "(with extra deps)" : "");
  }
}

module.exports = { registerAll };
