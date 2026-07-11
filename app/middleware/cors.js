"use strict";
// app/middleware/cors.js
// CORS 跨域白名单 (2026-07-08 R3 修复: 从全开改为白名单)
// 内部网 + 反代场景, 默认只允许:
//   1. 同源 (无 Origin / 反代后 Host header 是内网 IP)
//   2. .env 显式列出的 CORS_ALLOWED_ORIGINS 域名
// Author: 三狗子 | 2026-06-24; R3 收紧 by Codex audit follow-up

const cors = require('cors');

const DEFAULT_ALLOWED = [
  // 内网 IP + localhost, 配合 nginx 443 反代
  'http://192.168.1.73',
  'https://192.168.1.73',
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
];

function parseAllowed() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ALLOWED;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function corsMiddleware(app) {
  const allowed = parseAllowed();
  // 暴露给前端的 request-id (响应拦截器已经会注入, 这里只确保 CORS 头不影响)
  app.use(cors({
    origin: (origin, cb) => {
      // 同源请求 (curl / 服务端直连 / server-side fetch) 没有 Origin, 直接放行
      if (!origin) return cb(null, true);
      if (allowed.indexOf(origin) !== -1) return cb(null, true);
      return cb(null, false); // 不抛错, 浏览器会拦; 但响应不带 CORS 头
    },
    credentials: true, // 允许带 cookie (auth 用)
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  }));
  // 记录一次启动配置, 便于排查
  console.log('[cors] allowed origins:', allowed.join(', '));
}

module.exports = corsMiddleware;