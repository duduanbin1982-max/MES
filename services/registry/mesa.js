"use strict";

const { onlyForemanOrAdmin, onlyWelder, foremanOrWorker } = require("../../middleware/guards");

const MESA_SERVICES = [
  { name: "andonService", module: "./andon", schemaVersion: 2 },
  { name: "attendanceService", module: "./attendanceService", schemaVersion: 1 },
  { name: "bomService", module: "./bomService", schemaVersion: 1 },
  {
    name: "criticalPartsService",
    module: "./criticalPartsService",
    schemaVersion: 2,
    dependsOn: ["tbmAdvanced"],
  },
  { name: "cost", module: "./cost", schemaVersion: 1 },
  { name: "documentService", module: "./documentService", schemaVersion: 2 },
  { name: "eco", module: "./eco", schemaVersion: 1 },
  { name: "fieldService", module: "./fieldService", schemaVersion: 1 },
  { name: "kitCheck", module: "./kitCheck", schemaVersion: 1 },
  { name: "laborService", module: "./laborService", schemaVersion: 1 },
  { name: "maintenanceDashboardService", module: "./maintenanceDashboardService", schemaVersion: 1 },
  { name: "oeeService", module: "./oeeService", schemaVersion: 1 },
  { name: "pickService", module: "./pickService", schemaVersion: 1 },
  { name: "process", module: "./process", schemaVersion: 1 },
  { name: "processHoursService", module: "./processHoursService", schemaVersion: 2 },
  { name: "processMasterService", module: "./processMasterService", schemaVersion: 1 },
  { name: "processRouteService", module: "./processRouteService", schemaVersion: 1 },
  { name: "processTree", module: "./processTree", schemaVersion: 2 },
  { name: "qcService", module: "./qcService", schemaVersion: 2 },
  { name: "shopfloorService", module: "./shopfloorService", schemaVersion: 1 },
  { name: "shortageClosureService", module: "./shortageClosureService", schemaVersion: 1 },
  { name: "spcService", module: "./spcService", schemaVersion: 1 },
  { name: "tbmAdvanced", module: "./tbmAdvanced", schemaVersion: 1 },
  { name: "traceService", module: "./traceService", schemaVersion: 2 },
  { name: "workOrderService", module: "./workOrderService", schemaVersion: 1, deps: { onlyForemanOrAdmin, onlyWelder, foremanOrWorker } },
];

module.exports = { MESA_SERVICES };
