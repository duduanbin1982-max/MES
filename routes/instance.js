// routes/instance.js
// 实例路由分发器 — 子路由按领域拆分 (brooks-audit R2)
//   process.js (7) + material.js (4) + operations.js (4) = 15 端点
'use strict';

function register(app, db) {
  require('./instance/process').register(app, db);
  require('./instance/material').register(app, db);
  require('./instance/operations').register(app, db);
}

module.exports = { register };
