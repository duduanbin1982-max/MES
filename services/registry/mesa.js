"use strict";

const { onlyForemanOrAdmin, onlyForemanAdminOrPlanner, onlyWelder, foremanOrWorker } = require("../../middleware/guards");

const MESA_SERVICES = [
  { name: "andonService", module: "./andon", schemaVersion: 2 },
  { name: "attendanceService", module: "./attendanceService", schemaVersion: 1 },
  { name: "bomService", module: "./bomService", schemaVersion: 3 },
  {
    name: "criticalPartsService",
    module: "./criticalPartsService",
    schemaVersion: 2,
    dependsOn: ["tbmAdvanced"],
  },
  { name: "codingRulesService", module: "./codingRulesService", schemaVersion: 2 },
  { name: "cost", module: "./cost", schemaVersion: 8 },
  { name: "documentService", module: "./documentService", schemaVersion: 7 },
  { name: "eco", module: "./eco", schemaVersion: 1 },
  { name: "fieldService", module: "./fieldService", schemaVersion: 1 },
  { name: "kitCheck", module: "./kitCheck", schemaVersion: 1 },
  { name: "laborService", module: "./laborService", schemaVersion: 2 },
  { name: "maintenanceDashboardService", module: "./maintenanceDashboardService", schemaVersion: 1 },
  { name: "oeeService", module: "./oeeService", schemaVersion: 2 },
  { name: "pickService", module: "./pickService", schemaVersion: 1 },
  { name: "process", module: "./process", schemaVersion: 3 },
  { name: "processHoursService", module: "./processHoursService", schemaVersion: 2 },
  { name: "processMasterService", module: "./processMasterService", schemaVersion: 2 },
  { name: "processRouteService", module: "./processRouteService", schemaVersion: 2 },
  { name: "processTree", module: "./processTree", schemaVersion: 4 },
  { name: "qcService", module: "./qcService", schemaVersion: 2 },
  { name: "shopfloorService", module: "./shopfloorService", schemaVersion: 1 },
  { name: "shortageClosureService", module: "./shortageClosureService", schemaVersion: 1 },
  { name: "spcService", module: "./spcService", schemaVersion: 1 },
  { name: "tbmAdvanced", module: "./tbmAdvanced", schemaVersion: 1 },
  { name: "traceService", module: "./traceService", schemaVersion: 3 },
  { name: "workOrderService", module: "./workOrderService", schemaVersion: 3, deps: { onlyForemanOrAdmin, onlyForemanAdminOrPlanner, onlyWelder, foremanOrWorker } },
];

module.exports = { MESA_SERVICES };
