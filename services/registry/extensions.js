"use strict";

const EXTENSION_SERVICES = [
  { name: "aiPredictionService", module: "./aiPredictionService", schemaVersion: 2 },
  { name: "digitalTwinService", module: "./digitalTwinService", schemaVersion: 1 },
  { name: "erpService", module: "./erpService", schemaVersion: 1 },
  { name: "iotService", module: "./iotService", schemaVersion: 3 },
  { name: "iotLifecycleService", module: "./iotLifecycleService", schemaVersion: 1 },
  { name: "plmService", module: "./plmService", schemaVersion: 1 },
  { name: "supplierDashboardService", module: "./supplierDashboardService", schemaVersion: 1 },
  {
    name: "supplierCollaborationService",
    module: "./supplierCollaboration",
    schemaVersion: 2,
    dependsOn: ["purchase"],
  },
];

module.exports = { EXTENSION_SERVICES };
