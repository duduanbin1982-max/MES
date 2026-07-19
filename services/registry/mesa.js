"use strict";

const { onlyForemanOrAdmin, onlyWelder } = require("../../middleware/guards");

const MESA_SERVICES = [
  { name: "andonService", module: "./andonService" },
  { name: "attendanceService", module: "./attendanceService" },
  { name: "bomService", module: "./bomService" },
  { name: "criticalPartsService", module: "./criticalPartsService" },
  { name: "cost", module: "./cost" },
  { name: "documentService", module: "./documentService" },
  { name: "eco", module: "./eco" },
  { name: "fieldService", module: "./fieldService" },
  { name: "kitCheck", module: "./kitCheck" },
  { name: "laborService", module: "./laborService" },
  { name: "maintenanceDashboardService", module: "./maintenanceDashboardService" },
  { name: "oeeService", module: "./oeeService" },
  { name: "pickService", module: "./pickService" },
  { name: "process", module: "./process" },
  { name: "processHoursService", module: "./processHoursService" },
  { name: "processMasterService", module: "./processMasterService" },
  { name: "processRouteService", module: "./processRouteService" },
  { name: "processTree", module: "./processTree" },
  { name: "qcService", module: "./qcService" },
  { name: "shopfloorService", module: "./shopfloorService" },
  { name: "shortageClosureService", module: "./shortageClosureService" },
  { name: "spcService", module: "./spcService" },
  { name: "tbmAdvanced", module: "./tbmAdvanced" },
  { name: "traceService", module: "./traceService" },
  { name: "workOrderService", module: "./workOrderService", deps: { onlyForemanOrAdmin, onlyWelder } },
];

module.exports = { MESA_SERVICES };
