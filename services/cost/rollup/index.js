"use strict";
// services/cost/rollup/index.js
// rollup 子目录统一入口: 注册 rollup + breakdown 两个端点
// 2026-11-02：注册时幂等创建只读视图（readModel.js）
// Author: 三狗子 | Date: 2026-06-24

const rollup = require("./rollup");
const breakdown = require("./breakdown");
const { ensureReadModel } = require("./readModel");

function register(app, db) {
  ensureReadModel(db);
  rollup.register(app, db);
  breakdown.register(app, db);
}

module.exports = { register };
