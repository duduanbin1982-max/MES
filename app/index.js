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
  // 5. 请求日志
  logger(app);

  return app;
}

module.exports = { createApp, DIST, DIST_EXISTS };