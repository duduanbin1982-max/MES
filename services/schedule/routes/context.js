"use strict";
// services/schedule/routes.js 的 register() 前置逻辑

const logger = require("../../../app/logger").createLogger("scheduleService");
const { runMigration } = require("../schema");
const { initRescheduleLog } = require("../reschedule");
const { makeDbHelpers } = require("../_helpers");


module.exports = function createContext(app, db, deps) {

  runMigration(db);
  // 2026-11-03：批量重排程批次日志表
  initRescheduleLog(db);

  const { all, get, run } = makeDbHelpers(db);













  logger.info("[scheduleService] Dispatch scheduling registered");
  return { all, get, run };
};
