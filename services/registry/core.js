"use strict";

const CORE_SERVICES = [
  { name: "dashboardAlerts", module: "./dashboardAlerts", schemaVersion: 1 },
  { name: "delayAlerts", module: "./delayAlerts", schemaVersion: 1 },
  { name: "deliveryService", module: "./deliveryService", schemaVersion: 3 },
  { name: "equipment", module: "./equipment", schemaVersion: 2 },
  { name: "material", module: "./material", schemaVersion: 1 },
  { name: "materialPlanner", module: "./materialPlanner", schemaVersion: 2 },
  { name: "materialService", module: "./materialService", schemaVersion: 1 },
  { name: "purchase", module: "./purchase", schemaVersion: 2 },
  { name: "reportService", module: "./reportService", schemaVersion: 3 },
  { name: "resourceService", module: "./resourceService", schemaVersion: 2 },
  { name: "scanner", module: "./scanner", schemaVersion: 1 },
  { name: "scheduleService", module: "./schedule", schemaVersion: 2 },
];

module.exports = { CORE_SERVICES };
