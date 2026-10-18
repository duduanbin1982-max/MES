"use strict";
// services/traceService.js
// P0 端到端追溯装配层：正向、反向、矩阵、装配树、证书分模块注册。

const { createTraceStore } = require("./trace/store");
const { registerForwardTraceRoutes } = require("./trace/forward");
const { registerBackwardTraceRoutes } = require("./trace/backward");
const { registerTraceTreeRoutes } = require("./trace/tree");
const { registerCertificateRoutes } = require("./trace/certificate");
const { registerTraceRecordRoutes } = require("./trace/records");
const { ensureChainSchema } = require("./trace/chainSchema");
const { registerChainRoutes } = require("./trace/chain");

function register(app, db) {
  const store = createTraceStore(db);
  registerForwardTraceRoutes(app, store);
  registerBackwardTraceRoutes(app, store);
  registerTraceTreeRoutes(app, store);
  registerCertificateRoutes(app, store);
  registerTraceRecordRoutes(app, db);
  // 2026-10-18 P0-2：五级链路软关联 + 统一链路接口
  ensureChainSchema(db);
  registerChainRoutes(app, db);
}

module.exports = { register };
