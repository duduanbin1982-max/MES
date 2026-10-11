"use strict";

const { applyTemplateToNode, validateAssignment } = require("./processMaster/assignment");
const { registerDocumentRoutes } = require("./processMaster/documentRoutes");
const { runMigration } = require("./processMaster/migration");
const { registerOperationRoutes } = require("./processMaster/operationRoutes");
const { registerOverviewRoutes } = require("./processMaster/overviewRoutes");
const { registerPositionRoutes } = require("./processMaster/positionRoutes");

const logger = require("../app/logger").createLogger("processMasterService");

function register(app, db) {
  runMigration(db);
  registerOverviewRoutes(app, db);
  registerPositionRoutes(app, db);
  registerOperationRoutes(app, db);
  registerDocumentRoutes(app, db);
  logger.info("[processMasterService] Process operation/position master data registered");
}

module.exports = {
  register,
  runMigration,
  applyTemplateToNode,
  validateAssignment,
};
