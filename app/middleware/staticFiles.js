"use strict";
// app/middleware/staticFiles.js
// 静态资源 (先于 helmet 挂, 避免 helmet header 干扰静态)
//   路径在 app/config/paths.js
//   dist 不存在时降级, SPA fallback 失效
// Author: 三狗子 | Date: 2026-06-24

const express = require('express');
const { DIST, DIST_EXISTS } = require('../config/paths');

function staticFiles(app) {
  if (DIST_EXISTS) {
    app.use(express.static(DIST));
  } else {
    console.warn('[app.js] frontend/dist 不存在; 跳过 static. SPA fallback 会降级.');
  }
}

module.exports = staticFiles;