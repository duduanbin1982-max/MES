"use strict";
// services/process/node/index.js
// 工艺节点模块统一入口
// 拆成 4 个子模块: CRUD / 业务动作 / 工艺参数 / 依赖
// Author: 三狗子 | Date: 2026-06-24

const nodeCrud = require("./nodeCrud");
const nodeActions = require("./nodeActions");
const dependencies = require("./dependencies");

function register(app, db) {
  nodeCrud.register(app, db);
  nodeActions.register(app, db);
  dependencies.register(app, db);
}

module.exports = { register };
