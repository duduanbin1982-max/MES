"use strict";

const CORE_SERVICES = [
  { name: "dashboardAlerts", module: "./dashboardAlerts" },
  { name: "delayAlerts", module: "./delayAlerts" },
  { name: "deliveryService", module: "./deliveryService" },
  { name: "equipment", module: "./equipment" },
  { name: "material", module: "./material" },
  { name: "materialPlanner", module: "./materialPlanner" },
  { name: "materialService", module: "./materialService" },
  { name: "purchase", module: "./purchase" },
  { name: "reportService", module: "./reportService" },
  { name: "resourceService", module: "./resourceService" },
  { name: "scheduleService", module: "./scheduleService" },
];

module.exports = { CORE_SERVICES };
