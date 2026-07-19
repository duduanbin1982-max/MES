"use strict";

const { ApiError } = require("../app/errors");
const { createDbHelpers } = require("./qc/dbHelpers");
const { registerCapaRoutes } = require("./qc/capaRoutes");
const { registerClosureRoutes } = require("./qc/closureRoutes");
const { registerDashboardRoutes } = require("./qc/dashboardRoutes");
const { registerInspectionRoutes } = require("./qc/inspectionRoutes");
const { registerNcrRoutes } = require("./qc/ncrRoutes");
const { initQualitySchema } = require("./qc/schema");

function register(app, db) {
  const helpers = createDbHelpers(db);
  initQualitySchema(helpers.run);
  const dependencies = { app, db, helpers, ApiError };

  registerInspectionRoutes(dependencies);
  registerNcrRoutes(dependencies);
  registerCapaRoutes(dependencies);
  registerClosureRoutes(dependencies);
  registerDashboardRoutes(dependencies);
}

module.exports = { register };
