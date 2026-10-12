const { wrap } = require('../../middleware/asyncHandler');
const { ApiError } = require('../../app/errors');
const { makeDbHelpers } = require('../material/core');
const { getBomRows, aggregateDemand, getStockMap, computeKitItems } = require('../kitCheckCore');
const createContext = require("./context");
const registerRoutes1 = require("./routes_1");
const registerRoutes2 = require("./routes_2");

// services/materialPlanner.js - 物料预警 + 齐套检查 (P1-3 refactor)

function register(app, db) {
  const ctx = createContext(app, db);
  registerRoutes1(app, db, ctx);
  registerRoutes2(app, db, ctx);
}

module.exports = { register };
