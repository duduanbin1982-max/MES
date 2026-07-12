"use strict";
// services/oeeService.js
// P1 OEE 深度分析装配层：migration/store/helpers/routes 分离。
//
// ⚠️  @deprecated 2026-07-11 (brooks-audit R4 决策 ADR-003)
//   0 外部 require (register-all.js 不调用这个文件, OEE 业务跑在 services/oee/ 子目录的 7 个文件)
//   保留: 历史 facade 快照
//   未来: Phase 2 cleanup 时评估删除

const { runMigration } = require("./oee/migration");
const { createOeeStore } = require("./oee/store");
const { registerOverviewRoutes } = require("./oee/overview");
const { registerTrendRoutes } = require("./oee/trends");
const { registerLossRoutes } = require("./oee/losses");
const { registerShiftLogRoutes } = require("./oee/shiftLog");

function register(app, db) {
  runMigration(db);
  const store = createOeeStore(db);
  registerOverviewRoutes(app, store);
  registerTrendRoutes(app, store);
  registerLossRoutes(app, store);
  registerShiftLogRoutes(app, store);
}

module.exports = { register };
