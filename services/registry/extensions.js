"use strict";

const EXTENSION_SERVICES = [
  { name: "aiPredictionService", module: "./aiPredictionService" },
  { name: "digitalTwinService", module: "./digitalTwinService" },
  { name: "erpService", module: "./erpService" },
  { name: "iotService", module: "./iotService" },
  { name: "iotLifecycleService", module: "./iotLifecycleService" },
  { name: "plmService", module: "./plmService" },
  { name: "supplierDashboardService", module: "./supplierDashboardService" },
  { name: "supplierCollaborationService", module: "./supplierCollaborationService" },
];

module.exports = { EXTENSION_SERVICES };
