// server.js - TBM-MES v2.3 装配层
//   业务流程在 services/, 路由适配在 routes/, 角色守卫在 routes/guards.js
//   本文件只负责: 启动 express 实例 -> 挂载中间件 -> 装配各 routes/services -> listen
// 端口 3890 (绑 127.0.0.1, nginx 443 反代)
// Author: 三狗子 | Date: 2026-06-24

require('dotenv').config();

const http = require('http')
const path = require('path');
const { createApp } = require('./app');
const { attachWebSocket } = require('./app/ws/manager');
const db = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { apiPermissionMiddleware } = require('./middleware/apiPermissions');
const { onlyForemanOrAdmin, onlyWelder } = require('./routes/guards');

const app = createApp();
const express = require('express');
// P0-文档: 上传走 raw binary, 50MB 限制
app.use('/api/documents', (req, res, next) => {
  if (req.method === 'POST') {
    express.raw({ type: '*/*', limit: '50mb' })(req, res, next);
  } else next();
});
const PORT = 3890;

// P0-1: 启动时加载所有角色 permissions 到内存 (middleware/auth.js 缓存)
const { loadRolePermissions } = require('./middleware/auth');
loadRolePermissions(db);

// 根路由 + favicon + SPA fallback (无需 auth)
require('./routes/root').register(app);

// P1-2: 查询性能统计
app.get("/api/debug/db-stats", (_req, res) => {
  try { const { profileStats } = require("./db"); res.json(profileStats()); }
  catch(e) { res.json({ error: e.message }); }
});

// auth 白名单: /api/health 和 /api/auth/login
app.use('/api', authMiddleware);
app.use('/api', apiPermissionMiddleware);
app.use('/api', require('./app/middleware/auditTrail')(db));
require('./routes/auth').register(app, db);
require('./routes/health').register(app, db);
require('./routes/settings').register(app, db);
// P0-1: 角色管理 (admin only)
require('./routes/roles').register(app, db);
// P1-4: 审计日志查询 (audit:read)
require('./routes/audit').register(app, db);
// 帮助中心: 操作手册 Markdown
require('./routes/help').register(app, db);

// 实例重型路由 (16 条)
require('./routes/instance').register(app, db);

// services/ 模块化注册 (走 service 自己的 register)
require('./services/register-all').registerAll(app, db, {});
// MESA #5: IoT 数据采集器 (Modbus 模拟 + 实时入库 + WebSocket)
const iotCollector = require('./services/iotCollector');
// MESA #7: SPC 实时监控 (30s 间隔, WECO 规则 + Cpk 预警)
const spcMonitor = require('./services/spcMonitor');
iotCollector.start(db, 5000);
spcMonitor.start(db, 30000);

// P0-文档: 文档/图纸管理 + uploads 静态目录 (受 auth 保护, 仅 GET 可见)
app.use('/uploads', require('express').static('/home/dubin/factory-mes/data/uploads', { fallthrough: true }));


// P2 前端 SPA: 静态文件 + history fallback (nginx 反代到此端口)
const frontendDist = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(frontendDist, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
  }
}));
app.get(/^(?!\/api\/|\/ws|\/uploads).*$/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});
console.log('[spa] Frontend SPA served from ' + frontendDist);

// P0-3 统一错误响应: notFoundHandler + errorHandler (必须在所有 route 之后)
app._mountErrorHandlers();

// 启动
const httpServer = http.createServer(app);
attachWebSocket(httpServer);
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log('✓ TBM-MES v2.3 listening on 127.0.0.1:' + PORT + ' (经 nginx 443 反代暴露)');
  console.log('  Phase: phase-1 (Equipment-Centric + Process Tree + Settings)');
  console.log('  Routes: routes/ + services/');
  console.log('  Health: http://localhost:' + PORT + '/api/health');
});