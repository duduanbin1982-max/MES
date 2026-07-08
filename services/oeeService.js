"use strict";
// services/oeeService.js
// P1 OEE 深度分析装配层：migration/store/helpers/routes 分离。

const { runMigration } = require("./oee/migration");
const { createOeeStore } = require("./oee/store");
const { registerOverviewRoutes } = require("./oee/overview");
const { registerTrendRoutes } = require("./oee/trends");
const { registerLossRoutes } = require("./oee/losses");
const { registerShiftLogRoutes } = require("./oee/shiftLog");

function register(app, db) {
  runMigration(db);
  const store = createOeeStore(db);
  registerOverviewRoutes(app, store);
  registerTrendRoutes(app, store);
  registerLossRoutes(app, store);
  registerShiftLogRoutes(app, store);
}

module.exports = { register };
