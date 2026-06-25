"use strict";
// app/index.js
// 装配 express app: 静态 -> 安全头 -> CORS -> JSON 解析 -> 请求日志
//   顺序重要: 静态必须先于 helmet (避免 header 干扰)
// Author: 三狗子 | Date: 2026-06-24

const express = require('express');

// 中间件按职责拆分到 app/middleware/
const staticFiles = require('./middleware/staticFiles');
const security   = require('./middleware/security');
const corsMw     = require('./middleware/cors');
const parser     = require('./middleware/parser');
const logger     = require('./middleware/logger');
const requestIdMw = require('./middleware/requestId');
const responseInterceptor = require('./middleware/responseInterceptor');

// 错误处理 (P0-3)
const { errorHandler, notFoundHandler } = require('./errors');

// 路径常量 (兼容旧 require('../app') 拿 DIST/DIST_EXISTS)
const { DIST, DIST_EXISTS } = require('./config/paths');

function createApp() {
  const app = express();

  // 1. 静态资源 (先于 helmet)
  staticFiles(app);
  // 2. 安全头
  security(app);
  // 3. CORS
  corsMw(app);
  // 4. JSON / URL 解析
  parser(app);
  // 5. 请求 ID (P0-3, 给日志和错误响应串联)
  app.use(requestIdMw());
  // 6. 响应拦截器 (P0-3: 把 {error:msg} 统一为 {code,message,details,requestId})
  app.use(responseInterceptor());
  // 7. 请求日志
  logger(app);

  // 暴露给 server.js 挂 errorHandler/notFoundHandler (必须在所有 route 之后)
  app._mountErrorHandlers = () => {
    app.use(notFoundHandler);
    app.use(errorHandler);
  };

  return app;
}

module.exports = { createApp, DIST, DIST_EXISTS };