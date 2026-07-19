"use strict";
// services/registry.js
// Explicit service registry composition root. Keep startup surface intentional:
// service groups live under services/registry/*, while register-all consumes this
// single flattened list to preserve one application assembly boundary.

const { ADMIN_SERVICES } = require("./registry/admin");
const { CORE_SERVICES } = require("./registry/core");
const { EXTENSION_SERVICES } = require("./registry/extensions");
const { MESA_SERVICES } = require("./registry/mesa");

const SERVICES = [
  ...EXTENSION_SERVICES,
  ...CORE_SERVICES,
  ...MESA_SERVICES,
  ...ADMIN_SERVICES,
].map((entry) => ({ schemaVersion: 1, ...entry }));

module.exports = { SERVICES };
