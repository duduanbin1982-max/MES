"use strict";
// app/middleware/security.js
// Helmet 安全头 (CSP/COEP/COOP 关闭: 与 SPA + 反代兼容)
//   helmet({
//     crossOriginOpenerPolicy: false,
//     originAgentCluster: false,
//     contentSecurityPolicy: false,
//   })
// Author: 三狗子 | Date: 2026-06-24

const helmet = require('helmet');

function security(app) {
  app.use(helmet({
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: false,
  }));
}

module.exports = security;