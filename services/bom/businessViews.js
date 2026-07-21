"use strict";

const { buildKitRiskComponents, summarizeKitRisk } = require("../../app/domain/bomRisk");
const { summarizeProcessRoutes } = require("../../app/domain/processRoute");
const { buildPurchaseView } = require("./businessViews/purchaseView");
const { buildAssemblyView } = require("./businessViews/assemblyView");
const { buildRawView } = require("./businessViews/rawView");
const { buildCostView } = require("./businessViews/costView");
const { computeHealthView } = require("./businessViews/healthView");
const { loadBusinessViewContext } = require("./businessViews/context");
const { composeBusinessViews } = require("./businessViews/response");

function buildBusinessViews(deps, db, instanceId, rowsArg = null) {
  const context = loadBusinessViewContext({ db, instanceId, rowsArg, deps });
  const purchaseView = buildPurchaseView({ ...deps, ...context });
  const rawView = buildRawView({ ...deps, ...context });
  const assemblyView = buildAssemblyView({ ...deps, ...context });
  const costView = buildCostView({ ...deps, ...context });
  const riskComponents = buildKitRiskComponents(assemblyView.assemblyComponents, deps.uniqText);
  const processSummary = summarizeProcessRoutes(assemblyView.processComponents);

  return composeBusinessViews({
    context,
    purchaseView,
    rawView,
    assemblyView,
    costView,
    riskComponents,
    processSummary,
    round2: deps.round2,
    round3: deps.round3,
    summarizeKitRisk,
  });
}

function computeHealth(deps, db, instanceId, rowsArg = null) {
  return computeHealthView({
    db,
    instanceId,
    rowsArg,
    validateTree: deps.validateTree,
    detectDuplicates: deps.detectDuplicates,
    cleanText: deps.cleanText,
    normalizeBool: deps.normalizeBool,
    normalizeFloat: deps.normalizeFloat,
    normalizeInt: deps.normalizeInt,
    tierSummary: deps.tierSummary,
    SELF_MADE_CATEGORIES: deps.SELF_MADE_CATEGORIES,
    PURCHASED_CATEGORIES: deps.PURCHASED_CATEGORIES,
  });
}

function createBusinessViewsBuilder(deps) {
  return {
    buildBusinessViews: (db, instanceId, rowsArg = null) => buildBusinessViews(deps, db, instanceId, rowsArg),
    computeHealth: (db, instanceId, rowsArg = null) => computeHealth(deps, db, instanceId, rowsArg),
  };
}

module.exports = { createBusinessViewsBuilder };
