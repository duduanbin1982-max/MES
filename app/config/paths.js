"use strict";
// app/config/paths.js
// 路径常量: 前端 dist 目录 (SPA 构建产物)
// Author: 三狗子 | Date: 2026-06-24

const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
const DIST_EXISTS = fs.existsSync(DIST);

module.exports = { DIST, DIST_EXISTS };