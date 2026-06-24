"use strict";
// db/connection.js
// better-sqlite3 连接工厂: 解析 DB_PATH, 确保 data/ 存在, 返回 Database 实例
//   DB_PATH 优先从环境变量, 缺省用 data/mes.db
//   同步 API, 只在启动时调一次
// Author: 三狗子 | Date: 2026-06-24

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');
const DB_DIR = path.join(REPO_ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'mes.db');

function createConnection() {
  if (!process.env.DB_PATH && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  return new Database(DB_PATH);
}

module.exports = { createConnection, DB_PATH, DB_DIR };