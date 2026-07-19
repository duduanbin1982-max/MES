"use strict";

const { authMiddleware } = require("../../middleware/auth");

const ADMIN_SERVICES = [
  { name: "masterDataService", module: "./masterDataService" },
  { name: "projectMasterService", module: "./projectMasterService" },
  { name: "setupWizardService", module: "./setupWizardService" },
  { name: "userManagement", module: "./userManagement" },
  { name: "workflowService", module: "./workflowService", deps: authMiddleware },
];

module.exports = { ADMIN_SERVICES };
