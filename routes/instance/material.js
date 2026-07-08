// routes/instance/material.js
// Gantt 排程路由 (materialPlanner 已改为标准 register 模式)
const { getInstanceGantt, getResourcesGantt } = require('../../services/equipment/gantt');

function register(app, db) {
  app.get('/api/equipment_instances/:id/gantt', (req, res) => getInstanceGantt(req, res, db));
  app.get('/api/resources/gantt', (req, res) => getResourcesGantt(req, res, db));
}

module.exports = { register };
