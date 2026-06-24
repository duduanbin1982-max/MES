"use strict";
// db/index.js
// 顶层入口: 暴露 db 单例
//   兼容旧 require('../db') 拿 db 实例的代码 (server.js, migrate.js, middleware/auth.js, utils/partNo.js 等)
//   拆出: connection.js (路径+实例) + pragmas.js (性能/安全配置)
// Author: 三狗子 | Date: 2026-06-24

const applyPragmas = require('./pragmas');
const { createConnection } = require('./connection');

// 启动时建一次连接, 整个进程共享 (better-sqlite3 同步, 无连接池概念)
const db = createConnection();
applyPragmas(db);

module.exports = db;