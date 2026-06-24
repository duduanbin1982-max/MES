// db.js - 兼容垫片 (2026-06-24 拆分后保留)
// 旧 require('./db') 解析到 './db/index.js', 但 tests/utils-partno.test.js
// 显式 require.resolve('../db.js') 改 require.cache, 必须有 .js 文件存在.
module.exports = require('./db/index');