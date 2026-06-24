"use strict";
// services/cost/keyComponentPrices/index.js
// 关键件合同价 service 装配层
//   pricesCrud: 4 端点 (list/current/create/soft-delete)
//   priceDiff:  2 端点 (list/summary)
// Author: 三狗子 | Date: 2026-06-24

const pricesCrud = require("./pricesCrud");
const priceDiff = require("./priceDiff");

function register(app, db) {
  pricesCrud.register(app, db);
  priceDiff.register(app, db);
}

module.exports = { register };