// routes/instance/operations.js
// 仪表盘/扫码/进度路由 - 从 instance.js 拆分 (brooks-audit R2)
// dashboardAlerts 已改为标准 register(app,db), 由 register-all.js 自动发现
// P0-2 brooks-lint: 加 requirePermission (R3 dup 收编, default-deny)

const { wrap } = require('../../middleware/asyncHandler');
const { requirePermission } = require('../../middleware/auth');
const { scanLookup, scanExecute } = require('../../services/scanner');
const { getProcessProgress } = require('../../services/process/progress');

function register(app, db) {
  // dashboard/alerts 已迁移到 services/dashboardAlerts.js (标准 register 模式)
  // 2026-11-06（车间工作台审计）：扫码是现场工人的核心动作，不能只认 equipment:write
  app.get('/api/scan/lookup', requirePermission('equipment:read', 'shopfloor:read', 'work_order:read'), wrap((req, res) => scanLookup(req, res, db)));
  app.post('/api/scan/execute', requirePermission('equipment:write', 'shopfloor:write', 'work_order:write'), wrap((req, res) => scanExecute(req, res, db)));

  app.get('/api/process/progress/:instanceId', requirePermission('equipment:read'), wrap((req, res) => getProcessProgress(req, res, db, req.params.instanceId)));
  app.get('/api/equipment_instances/:id/process_progress', requirePermission('equipment:read'), wrap((req, res) => getProcessProgress(req, res, db, req.params.id)));
}

module.exports = { register };
