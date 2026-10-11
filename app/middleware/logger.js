"use strict";
// app/middleware/logger.js
// 请求日志 (morgan tiny 格式)
// 2026-10-11 (静态分析 v1 #3): 不再直接写 stdout，改走统一 logger
// (app/logger.js)，输出 JSON 行；systemd append 到 logs/mes.log。
// Author: 三狗子 | Date: 2026-06-24

const morgan = require('morgan');
const logger = require('../logger').createLogger('http');

function requestLogger(app) {
  app.use(morgan('tiny', {
    stream: {
      write(line) {
        logger.info(line.replace(/\r?\n$/, ''));
      },
    },
  }));
}

module.exports = requestLogger;
