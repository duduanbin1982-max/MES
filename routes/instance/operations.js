// routes/instance/operations.js
// 仪表盘/扫码/进度路由 - 从 instance.js 拆分 (brooks-audit R2)
// dashboardAlerts 已改为标准 register(app,db), 由 register-all.js 自动发现
// P0-2 brooks-lint: 加 requirePermission (R3 dup 收编, default-deny)

const { wrap } = require('../../middleware/asyncHandler');
const { requirePermission } = require('../../middleware/auth');
const { withServiceSchemaVersion } = require('../../db/serviceMigrations');
const { ensureQuantityColumns, scanLookup, scanExecute } = require('../../services/scanner');
const { getProcessProgress } = require('../../services/process/progress');

function register(app, db) {
  withServiceSchemaVersion(db, 'scanner', 1, ensureQuantityColumns);
  // dashboard/alerts 已迁移到 services/dashboardAlerts.js (标准 register 模式)
  app.get('/api/scan/lookup', requirePermission('equipment:read'), wrap((req, res) => scanLookup(req, res, db)));
  app.post('/api/scan/execute', requirePermission('equipment:write'), wrap((req, res) => scanExecute(req, res, db)));

  app.get('/api/process/progress/:instanceId', requirePermission('equipment:read'), wrap((req, res) => getProcessProgress(req, res, db, req.params.instanceId)));
}

module.exports = { register };
