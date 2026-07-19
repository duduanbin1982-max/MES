"use strict";

function defaultUniqText(values) {
  return Array.from(new Set((values || []).filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map((value) => String(value).trim())));
}

function kitStatusWeight(status) {
  const weights = { blocked: 3, incoming: 2, ready: 1 };
  return weights[status] || 0;
}

function buildKitRiskComponents(assemblyComponents, uniqText = defaultUniqText) {
  return (assemblyComponents || [])
    .filter((item) => item.kit_status !== "ready")
    .map((item) => ({
      component_id: item.component_id,
      component_name: item.component_name,
      part_number: item.part_number,
      kit_status: item.kit_status,
      shortage_line_count: item.kit_shortage_count,
      blocked_material_count: item.kit_blocked_count,
      incoming_material_count: item.kit_incoming_count,
      next_expected_date: item.next_expected_date,
      shortage_amount: item.shortage_amount,
      owners: uniqText((item.risk_items || []).flatMap((risk) => risk.owners || [])),
      purchase_order_count: (item.risk_items || []).reduce((sum, risk) => sum + Number((risk.purchase_orders || []).length), 0),
      purchase_request_count: uniqText((item.risk_items || []).flatMap((risk) => risk.purchase_request_nos || [])).length,
      items: item.risk_items,
    }))
    .sort((left, right) =>
      kitStatusWeight(right.kit_status) - kitStatusWeight(left.kit_status)
      || Number(right.shortage_amount || 0) - Number(left.shortage_amount || 0),
    );
}

function summarizeKitRisk(assemblyComponents, riskComponents) {
  const components = assemblyComponents || [];
  const risks = riskComponents || [];
  return {
    ready_count: components.filter((item) => item.kit_status === "ready").length,
    incoming_count: components.filter((item) => item.kit_status === "incoming").length,
    blocked_count: components.filter((item) => item.kit_status === "blocked").length,
    shortage_line_count: risks.reduce((sum, item) => sum + Number(item.shortage_line_count || 0), 0),
  };
}

module.exports = { buildKitRiskComponents, kitStatusWeight, summarizeKitRisk };
