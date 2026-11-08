"use strict";

const CORE_SERVICES = [
  { name: "dashboardAlerts", module: "./dashboardAlerts", schemaVersion: 1 },
  { name: "delayAlerts", module: "./delayAlerts", schemaVersion: 1 },
  { name: "deliveryService", module: "./deliveryService", schemaVersion: 4 },
  { name: "equipment", module: "./equipment", schemaVersion: 3 },
  { name: "material", module: "./material", schemaVersion: 1 },
  { name: "materialPlanner", module: "./materialPlanner", schemaVersion: 2 },
  { name: "materialService", module: "./materialService", schemaVersion: 1 },
  { name: "purchase", module: "./purchase", schemaVersion: 3 },
  { name: "reportService", module: "./reportService", schemaVersion: 6 },
  { name: "resourceService", module: "./resourceService", schemaVersion: 3 },
  { name: "scanner", module: "./scanner", schemaVersion: 1 },
  { name: "scheduleService", module: "./schedule", schemaVersion: 5 },
];

module.exports = { CORE_SERVICES };
