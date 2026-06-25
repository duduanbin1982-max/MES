// server.js - TBM-MES v2.3 装配层
//   业务流程在 services/, 路由适配在 routes/, 角色守卫在 routes/guards.js
//   本文件只负责: 启动 express 实例 -> 挂载中间件 -> 装配各 routes/services -> listen
// 端口 3890 (绑 127.0.0.1, nginx 443 反代)
// Author: 三狗子 | Date: 2026-06-24

require('dotenv').config();

const { createApp } = require('./app');
const db = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { onlyForemanOrAdmin, onlyWelder } = require('./routes/guards');

const app = createApp();
const PORT = 3890;

// P0-1: 启动时加载所有角色 permissions 到内存 (middleware/auth.js 缓存)
const { loadRolePermissions } = require('./middleware/auth');
loadRolePermissions(db);

// 根路由 + favicon + SPA fallback (无需 auth)
require('./routes/root').register(app);

// auth 白名单: /api/health 和 /api/auth/login
app.use('/api', authMiddleware);
require('./routes/auth').register(app, db);
require('./routes/health').register(app, db);
require('./routes/settings').register(app);
// P0-1: 角色管理 (admin only)
require('./routes/roles').register(app, db);
// P1-4: 审计日志查询 (audit:read)
require('./routes/audit').register(app, db);

// 实例重型路由 (16 条)
require('./routes/instance').register(app, db);

// services/ 模块化注册 (走 service 自己的 register)
require('./services/qcService').register(app, db);
require('./services/equipment/multiInstanceScheduler').register(app, db);
require('./services/equipment/oee').register(app, db);
require('./services/delayAlerts').register(app, db);
require('./services/equipment/scheduler').register(app, db);
require('./services/materialService').register(app, db);
require('./services/purchase').register(app, db);
require('./services/cost/keyComponentPrices').register(app, db);
require('./services/cost/rollup/index').register(app, db);
require('./services/cost/materialPrices').register(app, db);
require('./services/workOrderService').register(app, db, { onlyForemanOrAdmin, onlyWelder });
require('./services/equipment/service').register(app, db);
require('./services/process/node').register(app, db);
require('./services/reportService').register(app, db);
require('./services/process/params').register(app, db);
require('./services/eco').register(app, db);
require('./services/qcInspection').register(app, db);
require('./services/systemSettings').register(app, db);
require('./services/userManagement').register(app, db);

// P0-3 统一错误响应: notFoundHandler + errorHandler (必须在所有 route 之后)
app._mountErrorHandlers();

// 启动
app.listen(PORT, '127.0.0.1', () => {
  console.log('✓ TBM-MES v2.3 listening on 127.0.0.1:' + PORT + ' (经 nginx 443 反代暴露)');
  console.log('  Phase: phase-1 (Equipment-Centric + Process Tree + Settings)');
  console.log('  Routes: routes/ + services/');
  console.log('  Health: http://localhost:' + PORT + '/api/health');
});