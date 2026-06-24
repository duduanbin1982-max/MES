"use strict";
// services/cost/rollup/index.js
// rollup 子目录统一入口: 注册 rollup + breakdown 两个端点
// Author: 三狗子 | Date: 2026-06-24

const rollup = require("./rollup");
const breakdown = require("./breakdown");

function register(app, db) {
  rollup.register(app, db);
  breakdown.register(app, db);
}

module.exports = { register };