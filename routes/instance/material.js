// routes/instance/material.js
// Gantt 排程路由 (materialPlanner 已改为标准 register 模式)
// P0-2 brooks-lint: 加 requirePermission (R3 dup 收编, default-deny)
const { getInstanceGantt, getInstanceAlerts, getResourcesGantt } = require('../../services/equipment/gantt');
const { requirePermission } = require('../../middleware/auth');

function register(app, db) {
  app.get('/api/equipment_instances/:id/gantt', requirePermission('equipment:read'), (req, res) => getInstanceGantt(req, res, db));
  // 2026-11-05（审计 F-07）：单项目告警（不再复用全局 dashboard/alerts）
  app.get('/api/equipment_instances/:id/alerts', requirePermission('equipment:read'), (req, res) => getInstanceAlerts(req, res, db));
  app.get('/api/resources/gantt', requirePermission('equipment:read'), (req, res) => getResourcesGantt(req, res, db));
}

module.exports = { register };
