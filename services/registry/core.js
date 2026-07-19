"use strict";

const CORE_SERVICES = [
  { name: "dashboardAlerts", module: "./dashboardAlerts", schemaVersion: 1 },
  { name: "delayAlerts", module: "./delayAlerts", schemaVersion: 1 },
  { name: "deliveryService", module: "./deliveryService", schemaVersion: 1 },
  { name: "equipment", module: "./equipment", schemaVersion: 1 },
  { name: "material", module: "./material", schemaVersion: 1 },
  { name: "materialPlanner", module: "./materialPlanner", schemaVersion: 1 },
  { name: "materialService", module: "./materialService", schemaVersion: 1 },
  { name: "purchase", module: "./purchase", schemaVersion: 1 },
  { name: "reportService", module: "./reportService", schemaVersion: 1 },
  { name: "resourceService", module: "./resourceService", schemaVersion: 1 },
  { name: "scanner", module: "./scanner", schemaVersion: 1 },
  { name: "scheduleService", module: "./scheduleService", schemaVersion: 1 },
];

module.exports = { CORE_SERVICES };
