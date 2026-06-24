"use strict";
// services/cost/materialPrices/index.js
// 普通物料价 service 装配
//   pricesCrud:  3 端点 (detail/put/bulk)
//   pricesSummary: 1 端点 (coverage)
// Author: 三狗子 | Date: 2026-06-24

const pricesCrud = require("./pricesCrud");
const pricesSummary = require("./pricesSummary");

function register(app, db) {
  pricesCrud.register(app, db);
  pricesSummary.register(app, db);
}

module.exports = { register };