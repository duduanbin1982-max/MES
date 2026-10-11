"use strict";
// services/schedule/index.js
// 对外公共面：与原 services/scheduleService.js 的 { register } 一致，
// 另附内部件（runMigration / makeDbHelpers / toInt / normalizeDate）便于测试。

const { makeDbHelpers, toInt, normalizeDate } = require("./_helpers");
const { runMigration } = require("./schema");
const { register } = require("./routes");

module.exports = {
  register,
  runMigration,
  makeDbHelpers,
  toInt,
  normalizeDate,
};
