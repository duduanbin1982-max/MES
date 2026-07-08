// routes/instance/operations.js
// 仪表盘/扫码/进度路由 - 从 instance.js 拆分 (brooks-audit R2)
// dashboardAlerts 已改为标准 register(app,db), 由 register-all.js 自动发现

const { wrap } = require('../../middleware/asyncHandler');
const { scanLookup, scanExecute } = require('../../services/scanner');
const { getProcessProgress } = require('../../services/process/progress');

function register(app, db) {
  // dashboard/alerts 已迁移到 services/dashboardAlerts.js (标准 register 模式)
  app.get('/api/scan/lookup', wrap((req, res) => scanLookup(req, res, db)));
  app.post('/api/scan/execute', wrap((req, res) => scanExecute(req, res, db)));

  app.get('/api/process/progress/:instanceId', wrap((req, res) => getProcessProgress(req, res, db, req.params.instanceId)));
}

module.exports = { register };
