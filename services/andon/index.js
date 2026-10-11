"use strict";
// services/andon/index.js
// 对外公共面：与原 services/andonService.js 的 { register } 一致，
// 另附内部件（ensureSchema / createAlertEngine / createNotifier）便于测试。

const { makeDbHelpers } = require("./_helpers");
const { ensureSchema } = require("./schema");
const { createAlertEngine } = require("./alerts");
const { createNotifier } = require("./notify");
const { register } = require("./routes");

module.exports = {
  register,
  ensureSchema,
  createAlertEngine,
  createNotifier,
  makeDbHelpers,
};
