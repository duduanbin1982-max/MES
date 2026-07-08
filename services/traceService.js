"use strict";
// services/traceService.js
// P0 端到端追溯装配层：正向、反向、矩阵、装配树、证书分模块注册。

const { createTraceStore } = require("./trace/store");
const { registerForwardTraceRoutes } = require("./trace/forward");
const { registerBackwardTraceRoutes } = require("./trace/backward");
const { registerTraceTreeRoutes } = require("./trace/tree");
const { registerCertificateRoutes } = require("./trace/certificate");

function register(app, db) {
  const store = createTraceStore(db);
  registerForwardTraceRoutes(app, store);
  registerBackwardTraceRoutes(app, store);
  registerTraceTreeRoutes(app, store);
  registerCertificateRoutes(app, store);
}

module.exports = { register };
