"use strict";
// Public surface for ./ai/modelTraining.
// Backward-compatible re-export of all submodules so that:
//   const mt = require("./ai/modelTraining");
//   mt.register(app, db);
//   mt.predictFaultWithModels(db, ...);
// continue to work as before.

const { runMigration, columnNames, addColumn, ALLOWED_TABLES } = require("./schema");
const { trainingGroups, trainGroup, trainModels } = require("./training");
const { predictFaultWithModels, confidenceFor } = require("./prediction");
const { register } = require("./routes");
const { safeCode, parseJson, modelRow } = require("./_helpers");

module.exports = {
  // schema
  runMigration,
  columnNames,
  addColumn,
  ALLOWED_TABLES,
  // training
  trainingGroups,
  trainGroup,
  trainModels,
  // prediction
  predictFaultWithModels,
  confidenceFor,
  // routes
  register,
  // shared utilities (exposed for testability)
  safeCode,
  parseJson,
  modelRow,
};
