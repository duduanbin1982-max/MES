// services/material/inventory.js
// 库存 / 移动 / 调拨路由 — 从 materialService.js 拆分 (brooks-debt R1)
'use strict';

const { ApiError } = require("../../../app/errors");
const { wrap } = require('../../../middleware/asyncHandler');
const { DEFAULT_ROLE_PERMISSIONS, hasPermission } = require('../../../app/permissions');
const { emit, Events } = require('../../../app/ws/EventBus');
const { makeDbHelpers } = require('../core');

const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");
const registerRoutes3 = require("./routes_3");
const registerRoutes4 = require("./routes_4");
const registerRoutes5 = require("./routes_5");
const registerRoutes6 = require("./routes_6");

function register(app, db) {
  const ctx = createContext(app, db);
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
  registerRoutes3(app, db, ctx);
  registerRoutes4(app, db, ctx);
  registerRoutes5(app, db, ctx);
  registerRoutes6(app, db, ctx);
}

module.exports = { register };
