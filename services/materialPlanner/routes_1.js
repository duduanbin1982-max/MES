"use strict";
// services/materialPlanner.js 的路由组 1

module.exports = function registerRoutes1(app, db, ctx) {
const { wrap } = require('../../middleware/asyncHandler');
const { getKitCheck, getMaterialAlerts } = ctx;

  app.get('/api/equipment_instances/:id/material_alerts', wrap(getMaterialAlerts));

  app.get('/api/equipment_instances/:id/kit_check', wrap(getKitCheck));
};
