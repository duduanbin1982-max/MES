// app.js
// 2026-06-22 brooks-lint R2 修复：从 server.js 抽出
// 负责：创建 express app、装配全局中间件链（helmet/cors/json/morgan/static）

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, 'frontend', 'dist');
const DIST_EXISTS = fs.existsSync(DIST);

function createApp() {
  const app = express();

  // 1. 静态资源（先于 helmet，避免 helmet header 干扰静态）
  if (DIST_EXISTS) {
    app.use(express.static(DIST));
  } else {
    console.warn('[app.js] frontend/dist 不存在；跳过 static。SPA fallback 会降级。');
  }

  // 2. 安全头
  app.use(helmet({
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: false,
  }));

  // 3. CORS
  app.use(cors());

  // 4. JSON / URL 解析
  app.use(express.json());

  // 5. 请求日志
  app.use(morgan('tiny'));

  return app;
}

module.exports = { createApp, DIST, DIST_EXISTS };