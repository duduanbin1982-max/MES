"use strict";
// services/schedule/routes.js 的 register() 前置逻辑

const logger = require("../../../app/logger").createLogger("scheduleService");
const { runMigration } = require("../schema");
const { makeDbHelpers } = require("../_helpers");


module.exports = function createContext(app, db, deps) {

  runMigration(db);

  const { all, get, run } = makeDbHelpers(db);













  logger.info("[scheduleService] Dispatch scheduling registered");
  return { all, get, run };
};
