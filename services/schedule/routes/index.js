"use strict";
// services/schedule/routes.js
// 排程 HTTP 路由: 周视图 / 派工 / 状态流转 / 产能 / 日视图 / 我的任务。
// (原 services/scheduleService.js 第 57-337 行)

require("../../../app/errors");
require("../../../middleware/asyncHandler");
require("../../../app/logger").createLogger("scheduleService");
require("../_helpers");
require("../schema");

const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");
const { registerRescheduleRoutes } = require("../reschedule");
const registerGanttRoutes = require("./routes_gantt");

function register(app, db) {
  const ctx = createContext(app, db);
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
  registerRescheduleRoutes(app, db);
  registerGanttRoutes(app, db, ctx);
}

module.exports = { register };
