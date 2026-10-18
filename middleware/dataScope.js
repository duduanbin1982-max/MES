"use strict";
// middleware/dataScope.js
// P1-1（2026-10-18）：给每个请求挂一个**懒加载**的 req.scope()：
// 只有真正需要按数据范围过滤的接口才查 DB，其余接口零额外开销。

const { loadScope } = require("../app/dataScope");

function dataScopeMiddleware(db) {
  return (req, _res, next) => {
    let cached;
    req.scope = () => {
      if (cached === undefined) {
        const userId = req.user && (req.user.sub || req.user.uid || req.user.id);
        cached = loadScope(db, userId);
      }
      return cached;
    };
    next();
  };
}

module.exports = { dataScopeMiddleware };
