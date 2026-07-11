"use strict";
// services/registry.js
// Explicit service registry. Keep startup surface intentional; do not auto-load
// arbitrary files under services/.

const { onlyForemanOrAdmin, onlyWelder } = require("../middleware/guards");
const { authMiddleware } = require("../middleware/auth");

const SERVICES = [
  { name: "aiPredictionService", module: "./aiPredictionService" },
  { name: "andonService", module: "./andonService" },
  { name: "attendanceService", module: "./attendanceService" },
  { name: "bomService", module: "./bomService" },
  { name: "criticalPartsService", module: "./criticalPartsService" },
  { name: "cost", module: "./cost" },
  { name: "dashboardAlerts", module: "./dashboardAlerts" },
  { name: "delayAlerts", module: "./delayAlerts" },
  { name: "deliveryService", module: "./deliveryService" },
  { name: "digitalTwinService", module: "./digitalTwinService" },
  { name: "documentService", module: "./documentService" },
  { name: "eco", module: "./eco" },
  { name: "equipment", module: "./equipment" },
  { name: "erpService", module: "./erpService" },
  { name: "fieldService", module: "./fieldService" },
  { name: "iotService", module: "./iotService" },
  { name: "iotLifecycleService", module: "./iotLifecycleService" },
  { name: "kitCheck", module: "./kitCheck" },
  { name: "laborService", module: "./laborService" },
  { name: "maintenanceDashboardService", module: "./maintenanceDashboardService" },
  { name: "masterDataService", module: "./masterDataService" },
  { name: "material", module: "./material" },
  { name: "materialPlanner", module: "./materialPlanner" },
  { name: "materialService", module: "./materialService" },
  { name: "oeeService", module: "./oeeService" },
  { name: "pickService", module: "./pickService" },
  { name: "plmService", module: "./plmService" },
  { name: "processMasterService", module: "./processMasterService" },

  { name: "process", module: "./process" },
  { name: "processHoursService", module: "./processHoursService" },
  { name: "processRouteService", module: "./processRouteService" },
  { name: "processTree", module: "./processTree" },
  { name: "purchase", module: "./purchase" },
  { name: "qcService", module: "./qcService" },
  { name: "reportService", module: "./reportService" },
  { name: "resourceService", module: "./resourceService" },
  { name: "scheduleService", module: "./scheduleService" },
  { name: "setupWizardService", module: "./setupWizardService" },
  { name: "shopfloorService", module: "./shopfloorService" },
  { name: "shortageClosureService", module: "./shortageClosureService" },
  { name: "spcService", module: "./spcService" },
  { name: "supplierDashboardService", module: "./supplierDashboardService" },
  { name: "supplierCollaborationService", module: "./supplierCollaborationService" },
  { name: "tbmAdvanced", module: "./tbmAdvanced" },
  { name: "traceService", module: "./traceService" },
  { name: "userManagement", module: "./userManagement" },
  { name: "workOrderService", module: "./workOrderService", deps: { onlyForemanOrAdmin, onlyWelder } },
  { name: "workflowService", module: "./workflowService", deps: authMiddleware },
];

module.exports = { SERVICES };
