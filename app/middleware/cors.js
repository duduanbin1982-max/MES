"use strict";
// app/middleware/cors.js
// CORS 跨域 (默认全开, 配 nginx 反代后可收紧)
// Author: 三狗子 | Date: 2026-06-24

const cors = require('cors');

function corsMiddleware(app) {
  app.use(cors());
}

module.exports = corsMiddleware;