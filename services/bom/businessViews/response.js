"use strict";

function buildSummary({ context, purchaseItems, purchaseContractItems, rawView, assemblyComponents, processComponents, costView, riskComponents, round2 }) {
  return {
    total_nodes: context.rows.length,
    total_cost: round2(context.totalCost),
    purchase_line_count: purchaseItems.length,
    raw_line_count: rawView.rawItems.length,
    component_count: assemblyComponents.length,
    missing_price_count: costView.missingPriceCount,
    complete_process_components: processComponents.filter((item) => item.process_status === "success").length,
    purchase_contract_signed_count: purchaseContractItems.filter((item) => item.actual_unit_price !== null).length,
    purchase_contract_pending_count: purchaseContractItems.filter((item) => item.actual_unit_price === null).length,
    assembly_risk_component_count: riskComponents.length,
  };
}

function buildPurchaseSection(purchaseItems, purchaseContractItems, round2, round3) {
  return {
    total_quantity: round3(purchaseItems.reduce((sum, item) => sum + item.quantity, 0)),
    total_estimated_amount: round2(purchaseItems.reduce((sum, item) => sum + item.estimated_amount, 0)),
    missing_price_count: purchaseItems.reduce((sum, item) => sum + item.missing_price, 0),
    items: purchaseItems,
    contract_diff: {
      signed_count: purchaseContractItems.filter((item) => item.actual_unit_price !== null).length,
      pending_count: purchaseContractItems.filter((item) => item.actual_unit_price === null).length,
      over_budget_count: purchaseContractItems.filter((item) => item.diff_status === "over_budget" || item.diff_status === "over_20pct").length,
      total_estimated_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.estimated_amount || 0), 0)),
      total_actual_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.actual_amount || 0), 0)),
      total_diff_amount: round2(purchaseContractItems.reduce((sum, item) => sum + Number(item.diff_amount || 0), 0)),
      items: purchaseContractItems,
    },
  };
}

function buildCostSection(totalCost, costView, assemblyComponents, round2) {
  return {
    total_cost: round2(totalCost),
    by_category: costView.byCategory,
    by_component: assemblyComponents.map((component) => ({
      component_id: component.component_id,
      component_name: component.component_name,
      total_cost: component.total_cost,
      purchased_count: component.purchased_count,
      self_made_count: component.self_made_count,
      raw_count: component.raw_count,
    })),
    top_items: costView.topItems,
  };
}

function composeBusinessViews(input) {
  const { context, purchaseView, rawView, assemblyView, costView, riskComponents, processSummary, round2, round3, summarizeKitRisk } = input;
  const { purchaseItems, purchaseContractItems } = purchaseView;
  const { assemblyComponents, processComponents } = assemblyView;
  return {
    summary: buildSummary({ context, purchaseItems, purchaseContractItems, rawView, assemblyComponents, processComponents, costView, riskComponents, round2 }),
    purchase: buildPurchaseSection(purchaseItems, purchaseContractItems, round2, round3),
    assembly: {
      components: assemblyComponents,
      total_cost: round2(assemblyComponents.reduce((sum, item) => sum + item.total_cost, 0)),
      kit_summary: summarizeKitRisk(assemblyComponents, riskComponents),
      kit_risks: riskComponents,
    },
    raw: {
      total_estimated_amount: rawView.totalEstimatedAmount,
      total_weight: rawView.totalWeight,
      items: rawView.rawItems,
    },
    cost: buildCostSection(context.totalCost, costView, assemblyComponents, round2),
    process: {
      summary: {
        component_count: processSummary.component_count,
        complete_count: processSummary.complete_count,
        missing_route_count: processSummary.missing_route_count,
        missing_hours_count: processSummary.missing_hours_count,
        missing_workstation_count: processSummary.missing_workstation_count,
      },
      components: processComponents,
    },
  };
}

module.exports = { composeBusinessViews };
