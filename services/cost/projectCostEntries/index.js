"use strict";
// services/cost/projectCostEntries/index.js
// 对外公共面：与原 services/cost/projectCostEntries.js 的 3 个导出一致，
// 另附内部件（normalizeBody / makeDbHelpers / 常量 / 时间工具）便于测试。
//
// services/cost/index.js 里的 require('./projectCostEntries') 无需改动 ——
// 删掉同名 .js 后 Node 会解析到这个目录的 index.js。

const {
  COST_TYPES,
  COST_TYPE_LABELS,
  nowISO,
  todayISO,
  round2,
  normalizeBody,
  makeDbHelpers,
} = require("./_helpers");
const { ensureSchema } = require("./schema");
const { register } = require("./routes");

module.exports = {
  register,
  ensureSchema,
  COST_TYPES,
  COST_TYPE_LABELS,
  normalizeBody,
  makeDbHelpers,
  nowISO,
  todayISO,
  round2,
};
