"use strict";
// services/cost/index.js - P0-1 修复: 成本模块装配层
const materialPrices = require('./materialPrices');
const keyComponentPrices = require('./keyComponentPrices');
const rollup = require('./rollup');
function register(app, db) {
  materialPrices.register(app, db);
  keyComponentPrices.register(app, db);
  rollup.register(app, db);
}
module.exports = { register };
