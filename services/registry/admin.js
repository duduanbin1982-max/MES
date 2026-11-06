"use strict";

const { authMiddleware } = require("../../middleware/auth");

const ADMIN_SERVICES = [
  { name: "masterDataService", module: "./masterDataService", schemaVersion: 2 },
  { name: "projectMasterService", module: "./projectMasterService", schemaVersion: 1 },
  { name: "setupWizardService", module: "./setupWizardService", schemaVersion: 1 },
  { name: "userManagement", module: "./userManagement", schemaVersion: 5 },
  { name: "workflowService", module: "./workflowService", schemaVersion: 1, deps: authMiddleware },
];

module.exports = { ADMIN_SERVICES };
