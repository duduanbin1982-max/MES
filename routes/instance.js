"use strict";
// routes/instance.js
// 实例相关的重型路由 (业务逻辑在 services/, 这里只做 req/res 适配)
// 16 条端点:
//   POST  /api/equipment_instances/:id/process_tree/generate
//   GET   /api/equipment_instances/:id/critical_path
//   GET   /api/equipment_instances/:id/subsystems
//   GET   /api/equipment_instances/:id/cross_subsystem_deps
//   GET   /api/equipment_instances/:id/parts_tree
//   GET   /api/equipment_instances/:id/parts_tree/path
//   PATCH /api/process_nodes/:id/subsystem
//   GET   /api/equipment_instances/:id/material_alerts
//   GET   /api/equipment_instances/:id/kit_check
//   GET   /api/equipment_instances/:id/gantt
//   GET   /api/resources/gantt
//   GET   /api/dashboard/alerts
//   GET   /api/scan/lookup
//   POST  /api/scan/execute
//   GET   /api/equipment_instances/:id/process_progress
// Author: 三狗子 | Date: 2026-06-24

const { generateProcessTree, getCriticalPath } = require('../services/processTree/generator');
const { getMaterialAlerts, getKitCheck } = require('../services/materialPlanner');
const { getInstanceGantt, getResourcesGantt } = require('../services/equipment/gantt');
const { getDashboardAlerts } = require('../services/dashboardAlerts');
const { scanLookup, scanExecute } = require('../services/scanner');
const { getProcessProgress } = require('../services/process/progress');
const { getSubsystems } = require('../services/processTree/subsystems');
const { getMindmap } = require('../services/processTree/mindmap');
const { getBreadcrumb } = require('../services/processTree/breadcrumb');
const { getCrossSubsystemMatrix } = require('../services/processTree/crossSubsystemDeps');
const { patchNodeSubsystem } = require('../services/process/nodeSubsystem');

function register(app, db) {
  const { wrap } = require('./_helpers')(db);

  app.post('/api/equipment_instances/:id/process_tree/generate', (req, res) => generateProcessTree(req, res, db));

  app.get('/api/equipment_instances/:id/critical_path', (req, res) => getCriticalPath(req, res, db));
  app.get('/api/equipment_instances/:id/subsystems', (req, res) => getSubsystems(req, res, db));

  app.get('/api/equipment_instances/:id/cross_subsystem_deps', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const result = getCrossSubsystemMatrix(id);
    res.json(result);
  }));

  app.get('/api/equipment_instances/:id/parts_tree', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const partId = req.query.part_id || 'root';
    const result = getMindmap(id, partId);
    res.json(result);
  }));

  app.get('/api/equipment_instances/:id/parts_tree/path', wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    const partId = req.query.part_id || 'root';
    const result = getBreadcrumb(id, partId);
    res.json({ part_id: partId, breadcrumb: result });
  }));

  app.patch('/api/process_nodes/:id/subsystem', (req, res) => patchNodeSubsystem(req, res, db));

  app.get('/api/equipment_instances/:id/material_alerts', (req, res) => getMaterialAlerts(req, res, db));
  app.get('/api/equipment_instances/:id/kit_check', (req, res) => getKitCheck(req, res, db));
  app.get('/api/equipment_instances/:id/gantt', (req, res) => getInstanceGantt(req, res, db));
  app.get('/api/resources/gantt', (req, res) => getResourcesGantt(req, res, db));
  app.get('/api/dashboard/alerts', (req, res) => getDashboardAlerts(req, res, db));
  app.get('/api/scan/lookup', (req, res) => scanLookup(req, res, db));
  app.post('/api/scan/execute', (req, res) => scanExecute(req, res, db));
  app.get('/api/equipment_instances/:id/process_progress', (req, res) => getProcessProgress(req, res, db));
}

module.exports = { register };