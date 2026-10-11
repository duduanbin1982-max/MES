"use strict";

const { createDbContext } = require("./resourceService/dbContext");
const { runMigration } = require("./resourceService/schema");
const { registerWorkerRoutes } = require("./resourceService/workerRoutes");
const { registerWorkstationRoutes } = require("./resourceService/workstationRoutes");
const { registerSummaryRoutes } = require("./resourceService/summaryRoutes");
const { registerAllocationRoutes } = require("./resourceService/allocationRoutes");

const logger = require("../app/logger").createLogger("resourceService");

function register(app, db) {
  runMigration(db);
  const context = createDbContext(db);
  registerWorkerRoutes(app, context);
  registerWorkstationRoutes(app, context);
  registerSummaryRoutes(app, context);
  registerAllocationRoutes(app, context);
  logger.info("[resourceService] Resource management registered");
}

module.exports = { register };
