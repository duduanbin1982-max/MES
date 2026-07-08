"use strict";
// services/register-all.js
// Explicit service composition root. The registry is a deliberate API surface:
// a service is mounted only when listed in services/registry.js.

const { SERVICES } = require("./registry");

function registerAll(app, db) {
  for (const entry of SERVICES) {
    const mod = require(entry.module);
    if (!mod || typeof mod.register !== "function") {
      throw new Error(`[register-all] ${entry.name} does not export register(app, db)`);
    }
    if (Object.prototype.hasOwnProperty.call(entry, "deps")) {
      mod.register(app, db, entry.deps);
      console.log("[register-all]", entry.name, "(with extra deps)");
    } else {
      mod.register(app, db);
      console.log("[register-all]", entry.name);
    }
  }
}

module.exports = { registerAll };
