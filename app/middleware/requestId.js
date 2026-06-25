"use strict";
// app/middleware/requestId.js
// P0-3 给每个请求生成 ID, 透传到 res + 错误响应
// Author: 三狗子 | Date: 2026-06-25

const crypto = require('crypto');

function requestId() {
  return (req, res, next) => {
    // 优先用客户端传入 (方便排障), 没有则生成
    const incoming = req.headers['x-request-id'];
    req.id = (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 64)
      ? incoming
      : 'req_' + crypto.randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = requestId;
