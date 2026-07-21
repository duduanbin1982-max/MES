"use strict";

const EXTENSION_SERVICES = [
  { name: "aiPredictionService", module: "./aiPredictionService", schemaVersion: 1 },
  { name: "digitalTwinService", module: "./digitalTwinService", schemaVersion: 1 },
  { name: "erpService", module: "./erpService", schemaVersion: 1 },
  { name: "iotService", module: "./iotService", schemaVersion: 2 },
  { name: "iotLifecycleService", module: "./iotLifecycleService", schemaVersion: 1 },
  { name: "plmService", module: "./plmService", schemaVersion: 1 },
  { name: "supplierDashboardService", module: "./supplierDashboardService", schemaVersion: 1 },
  {
    name: "supplierCollaborationService",
    module: "./supplierCollaborationService",
    schemaVersion: 1,
    dependsOn: ["purchase"],
  },
];

module.exports = { EXTENSION_SERVICES };
