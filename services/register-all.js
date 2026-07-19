"use strict";
// services/register-all.js
// Explicit service composition root. The registry is a deliberate API surface:
// a service is mounted only when listed in services/registry.js.

const { SERVICES } = require("./registry");
const { withServiceSchemaVersion } = require("../db/serviceMigrations");

function registerAll(app, db) {
  for (const entry of SERVICES) {
    const mod = require(entry.module);
    if (!mod || typeof mod.register !== "function") {
      throw new Error(`[register-all] ${entry.name} does not export register(app, db)`);
    }
    const migration = withServiceSchemaVersion(db, entry.name, entry.schemaVersion || 1, (serviceDb) => {
      if (Object.prototype.hasOwnProperty.call(entry, "deps")) return mod.register(app, serviceDb, entry.deps);
      return mod.register(app, serviceDb);
    });
    console.log("[register-all]", entry.name, `schema=${migration.status}`, Object.prototype.hasOwnProperty.call(entry, "deps") ? "(with extra deps)" : "");
  }
}

module.exports = { registerAll };
