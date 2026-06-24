"use strict";
// app/middleware/parser.js
// JSON / URL 解析
//   express.json() 默认 100kb, 大文件上传走 multipart 单独处理
// Author: 三狗子 | Date: 2026-06-24

const express = require('express');

function parser(app) {
  app.use(express.json());
}

module.exports = parser;