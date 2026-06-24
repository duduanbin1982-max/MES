"use strict";
// app/middleware/logger.js
// 请求日志 (morgan tiny 格式, 输出到 stdout, systemd 转发到 data/mes.log)
// Author: 三狗子 | Date: 2026-06-24

const morgan = require('morgan');

function logger(app) {
  app.use(morgan('tiny'));
}

module.exports = logger;