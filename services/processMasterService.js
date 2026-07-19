"use strict";

const { applyTemplateToNode, validateAssignment } = require("./processMaster/assignment");
const { registerDocumentRoutes } = require("./processMaster/documentRoutes");
const { runMigration } = require("./processMaster/migration");
const { registerOperationRoutes } = require("./processMaster/operationRoutes");
const { registerOverviewRoutes } = require("./processMaster/overviewRoutes");
const { registerPositionRoutes } = require("./processMaster/positionRoutes");

function register(app, db) {
  runMigration(db);
  registerOverviewRoutes(app, db);
  registerPositionRoutes(app, db);
  registerOperationRoutes(app, db);
  registerDocumentRoutes(app, db);
  console.log("[processMasterService] Process operation/position master data registered");
}

module.exports = {
  register,
  runMigration,
  applyTemplateToNode,
  validateAssignment,
};
