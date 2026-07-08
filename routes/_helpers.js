"use strict";
const { wrap } = require('../middleware/asyncHandler');
// routes/_helpers.js
// server.js / routes/*.js 共享的 db 帮手
// (从 server.js L116-123 抽出, 之前 all/get/run 在 server.js 下方才定义, 登录路由在
//  上方使用只是因为 express handler 在请求时才执行才没炸; 现在统一从顶部拿到)
// Author: 三狗子 | Date: 2026-06-24

module.exports = function makeHelpers(db) {
  
  const all = (sql, params = []) => db.prepare(sql).all(params);
  const get = (sql, params = []) => db.prepare(sql).get(params);
  const run = (sql, params = []) => db.prepare(sql).run(params);
  return { wrap, all, get, run };
};