"use strict";

const PROCESS_ROUTE_GAPS = {
  NO_OPERATIONS: "missing_route",
  MISSING_HOURS: "missing_hours",
  MISSING_WORKSTATION: "missing_workstation",
  MISSING_SKILL: "missing_skill",
};

const GAP_MESSAGES = {
  detailed: {
    [PROCESS_ROUTE_GAPS.NO_OPERATIONS]: "未建立工序",
    [PROCESS_ROUTE_GAPS.MISSING_HOURS]: "存在工序缺标准工时",
    [PROCESS_ROUTE_GAPS.MISSING_WORKSTATION]: "存在工序未绑定工位",
    [PROCESS_ROUTE_GAPS.MISSING_SKILL]: "存在工序未设置技能/工种",
  },
  compact: {
    [PROCESS_ROUTE_GAPS.NO_OPERATIONS]: "未建立工序",
    [PROCESS_ROUTE_GAPS.MISSING_HOURS]: "缺标准工时",
    [PROCESS_ROUTE_GAPS.MISSING_WORKSTATION]: "缺工位",
    [PROCESS_ROUTE_GAPS.MISSING_SKILL]: "缺技能/工种",
  },
};

function processRouteGapCodes(operations = []) {
  const gaps = [];
  if (!operations.length) gaps.push(PROCESS_ROUTE_GAPS.NO_OPERATIONS);
  if (operations.some((operation) => !Number(operation.estimated_hours || 0))) gaps.push(PROCESS_ROUTE_GAPS.MISSING_HOURS);
  if (operations.some((operation) => !operation.required_workstation_id)) gaps.push(PROCESS_ROUTE_GAPS.MISSING_WORKSTATION);
  if (operations.some((operation) => !operation.required_skill)) gaps.push(PROCESS_ROUTE_GAPS.MISSING_SKILL);
  return gaps;
}

function processRouteGapMessages(operations = [], style = "detailed") {
  const messages = GAP_MESSAGES[style] || GAP_MESSAGES.detailed;
  return processRouteGapCodes(operations).map((code) => messages[code]);
}

function assessProcessRoute(component, operations = [], style = "detailed") {
  const gapCodes = processRouteGapCodes(operations);
  const standardManHours = operations.reduce((sum, operation) => sum + Number(operation.standard_man_hours || operation.estimated_hours || 0), 0);
  return {
    ok: gapCodes.length === 0,
    gap_codes: gapCodes,
    missing: gapCodes.map((code) => (GAP_MESSAGES[style] || GAP_MESSAGES.detailed)[code]),
    operation_count: operations.length,
    estimated_hours: operations.reduce((sum, operation) => sum + Number(operation.estimated_hours || 0), 0),
    standard_man_hours: Math.round(standardManHours * 100) / 100,
    workstation_count: new Set(operations.map((operation) => operation.required_workstation_id).filter(Boolean)).size,
    component,
  };
}

function summarizeProcessRoutes(routes = []) {
  const hasGap = (route, gapCode, text) => route.gap_codes?.includes(gapCode) || route.missing?.some((message) => message.includes(text));
  return {
    component_count: routes.length,
    complete_count: routes.filter((route) => route.ok || route.process_status === "success").length,
    missing_route_count: routes.filter((route) => hasGap(route, PROCESS_ROUTE_GAPS.NO_OPERATIONS, "未建立工序")).length,
    missing_hours_count: routes.filter((route) => hasGap(route, PROCESS_ROUTE_GAPS.MISSING_HOURS, "标准工时")).length,
    missing_workstation_count: routes.filter((route) => hasGap(route, PROCESS_ROUTE_GAPS.MISSING_WORKSTATION, "工位")).length,
    total_operations: routes.reduce((sum, route) => sum + Number(route.operation_count || 0), 0),
    total_estimated_hours: Math.round(routes.reduce((sum, route) => sum + Number(route.estimated_hours || 0), 0) * 100) / 100,
    total_standard_man_hours: Math.round(routes.reduce((sum, route) => sum + Number(route.standard_man_hours || 0), 0) * 100) / 100,
  };
}

module.exports = {
  PROCESS_ROUTE_GAPS,
  assessProcessRoute,
  processRouteGapCodes,
  processRouteGapMessages,
  summarizeProcessRoutes,
};
