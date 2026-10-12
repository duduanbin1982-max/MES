"use strict";
// services/schedule/routes.js
// 排程 HTTP 路由: 周视图 / 派工 / 状态流转 / 产能 / 日视图 / 我的任务。
// (原 services/scheduleService.js 第 57-337 行)

const { ApiError } = require("../../../app/errors");
const { wrap } = require("../../../middleware/asyncHandler");
const logger = require("../../../app/logger").createLogger("scheduleService");
const { makeDbHelpers, toInt, normalizeDate } = require("../_helpers");
const { runMigration } = require("../schema");

const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");

function register(app, db) {
  const ctx = createContext(app, db);
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
}

module.exports = { register };
