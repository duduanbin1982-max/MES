"use strict";

const { createEngine } = require("../app/workflow/engine");
const { createDbContext } = require("./eco/dbContext");
const { createImpactAnalyzer } = require("./eco/impact");
const { createDocumentLifecycle } = require("./eco/documentLifecycle");
const { registerEcoRoutes, registerWorkflowRoutes } = require("./eco/routes");

function register(app, db) {
  const context = createDbContext(db);
  const buildImpact = createImpactAnalyzer(db);
  const archiveDocuments = createDocumentLifecycle(db);
  registerEcoRoutes(app, context, buildImpact);
  registerWorkflowRoutes(app, context, createEngine(db), archiveDocuments);
}

module.exports = { register };
