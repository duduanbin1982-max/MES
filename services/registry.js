"use strict";
// services/registry.js
// Explicit service registry composition root. Keep startup surface intentional:
// service groups live under services/registry/*, while register-all consumes this
// single flattened list to preserve one application assembly boundary.

const { ADMIN_SERVICES } = require("./registry/admin");
const { CORE_SERVICES } = require("./registry/core");
const { EXTENSION_SERVICES } = require("./registry/extensions");
const { MESA_SERVICES } = require("./registry/mesa");

const DECLARED_SERVICES = [
  ...EXTENSION_SERVICES,
  ...CORE_SERVICES,
  ...MESA_SERVICES,
  ...ADMIN_SERVICES,
];

const names = new Set();
for (const entry of DECLARED_SERVICES) {
  if (names.has(entry.name)) throw new Error(`[service-registry] duplicate service name: ${entry.name}`);
  names.add(entry.name);
  if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) {
    throw new Error(`[service-registry] ${entry.name} must declare a positive integer schemaVersion`);
  }
}

function orderByDependencies(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(entry) {
    if (visited.has(entry.name)) return;
    if (visiting.has(entry.name)) throw new Error(`[service-registry] dependency cycle at ${entry.name}`);
    visiting.add(entry.name);
    for (const dependencyName of entry.dependsOn || []) {
      const dependency = byName.get(dependencyName);
      if (!dependency) throw new Error(`[service-registry] ${entry.name} depends on unknown service ${dependencyName}`);
      visit(dependency);
    }
    visiting.delete(entry.name);
    visited.add(entry.name);
    ordered.push(entry);
  }

  for (const entry of entries) visit(entry);
  return ordered;
}

const SERVICES = orderByDependencies(DECLARED_SERVICES);

module.exports = { SERVICES, orderByDependencies };
