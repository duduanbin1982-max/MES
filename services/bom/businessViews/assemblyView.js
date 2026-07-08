"use strict";

function buildAssemblyView(ctx) {
  const {
    rows,
    childMap,
    costMap,
    docMap,
    processNodes,
    totalDemandMap,
    stockMap,
    inboundByMaterial,
    purchasePoByMaterial,
    shortageByMaterial,
    resolvedShortageByMaterial,
    PURCHASED_CATEGORIES,
    SELF_MADE_CATEGORIES,
    collectDescendantIds,
    normalizeBool,
    normalizeInt,
    normalizeFloat,
    isActiveShortageStatus,
    cleanText,
    earliestDate,
    round2,
    round3,
    statusType,
    uniqText,
  } = ctx;

  const components = rows.filter((row) => Number(row.tier) === 1);
  const assemblyComponents = components.map((component) => {
    const scopeIds = collectDescendantIds(childMap, component.id);
    const scopeRows = rows.filter((row) => scopeIds.has(Number(row.id)));
    const leafRows = scopeRows.filter((row) => !(childMap.get(Number(row.id)) || []).length);
    const purchasedCount = scopeRows.filter((row) => PURCHASED_CATEGORIES.has(row.category) && Number(row.tier) >= 2).length;
    const selfMadeCount = scopeRows.filter((row) => SELF_MADE_CATEGORIES.has(row.category) && Number(row.tier) >= 2).length;
    const rawCount = scopeRows.filter((row) => Number(row.tier) === 3).length;
    const linkedDocs = scopeRows.reduce((sum, row) => sum + ((docMap.get(Number(row.id)) || []).length), 0);
    const processOps = processNodes.filter((node) => node.bom_node_id && scopeIds.has(Number(node.bom_node_id)));
    const missing = [];
    if (!processOps.length) missing.push("未建立工序");
    if (processOps.some((op) => !Number(op.estimated_hours || 0))) missing.push("存在工序缺标准工时");
    if (processOps.some((op) => !op.required_workstation_id)) missing.push("存在工序未绑定工位");
    if (processOps.some((op) => !op.required_skill)) missing.push("存在工序未设置技能/工种");
    const bomBoundCount = scopeRows.filter((row) => Number(row.tier) >= 2 && row.operation_id).length;
    const totalProcessHours = processOps.reduce((sum, op) => sum + Number(op.estimated_hours || 0), 0);
    const totalStandardManHours = processOps.reduce((sum, op) => sum + Number(op.standard_man_hours || op.estimated_hours || 0), 0);
    const componentDemandRows = scopeRows.filter((row) => {
      if (normalizeBool(row.is_phantom)) return false;
      if (!normalizeInt(row.material_id, null)) return false;
      return PURCHASED_CATEGORIES.has(row.category) || Number(row.tier) === 3;
    });
    const componentDemandMap = new Map();
    for (const row of componentDemandRows) {
      const materialId = Number(row.material_id);
      componentDemandMap.set(materialId, Number(componentDemandMap.get(materialId) || 0) + Number(row.quantity || 0));
    }
    const kitItems = [...componentDemandMap.entries()].map(([materialId, requiredQty]) => {
      const totalRequired = Number(totalDemandMap.get(materialId) || 0);
      const availableQty = Number(stockMap.get(materialId) || 0);
      const inbound = inboundByMaterial.get(materialId) || { open_qty: 0, next_expected_date: null, po_nos: [] };
      const poRows = purchasePoByMaterial.get(materialId) || [];
      const shortageRows = (shortageByMaterial.get(materialId) || []).filter((row) => isActiveShortageStatus(row.status));
      const resolvedRows = resolvedShortageByMaterial.get(materialId) || [];
      const inboundQty = Number(inbound.open_qty || 0);
      const resolvedQty = resolvedRows.reduce((sum, row) => sum + Number(row.shortage_qty || 0), 0);
      const effectiveAvailableQty = availableQty + resolvedQty;
      const globalShortage = Math.max(totalRequired - effectiveAvailableQty, 0);
      const projectedShortage = Math.max(totalRequired - effectiveAvailableQty - inboundQty, 0);
      const attributableShortage = Math.min(Number(requiredQty || 0), globalShortage);
      const attributableProjected = Math.min(Number(requiredQty || 0), projectedShortage);
      const sampleRow = componentDemandRows.find((row) => Number(row.material_id) === materialId) || {};
      const owners = uniqText([
        ...shortageRows.map((row) => row.owner_name),
        ...poRows.map((row) => row.full_name),
        ...poRows.map((row) => row.approved_by_name),
      ]);
      const primaryOwner = cleanText(shortageRows.find((row) => cleanText(row.owner_name))?.owner_name)
        || cleanText(poRows.find((row) => cleanText(row.full_name))?.full_name)
        || cleanText(poRows.find((row) => cleanText(row.approved_by_name))?.approved_by_name)
        || null;
      let riskStatus = "ready";
      if (attributableProjected > 0) riskStatus = "blocked";
      else if (attributableShortage > 0) riskStatus = "incoming";
      return {
        material_id: materialId,
        material_code: sampleRow.material_code || null,
        material_name: sampleRow.material_name || null,
        part_number: sampleRow.part_number || null,
        category: sampleRow.category || null,
        required_qty: round3(requiredQty),
        total_required_qty: round3(totalRequired),
        available_qty: round3(availableQty),
        resolved_qty: round3(resolvedQty),
        inbound_qty: round3(inboundQty),
        shortage_qty: round3(attributableShortage),
        projected_shortage_qty: round3(attributableProjected),
        next_expected_date: earliestDate([
          inbound.next_expected_date,
          ...poRows.map((row) => row.expected_date),
          ...shortageRows.map((row) => row.expected_date),
        ]),
        po_nos: uniqText(inbound.po_nos || []),
        risk_status: riskStatus,
        owners,
        primary_owner: primaryOwner,
        purchase_request_nos: uniqText(shortageRows.map((row) => row.purchase_request_no)),
        purchase_orders: poRows.map((row) => ({
          purchase_order_id: row.purchase_order_id,
          po_id: row.po_id,
          po_no: row.po_no,
          status: row.po_status,
          supplier_name: row.supplier_name || null,
          ordered_qty: round3(row.quantity),
          received_qty: round3(row.received_qty),
          open_qty: round3(Math.max(Number(row.quantity || 0) - Number(row.received_qty || 0), 0)),
          unit_price: normalizeFloat(row.unit_price, null),
          total_price: normalizeFloat(row.total_price, null),
          expected_date: row.expected_date || null,
          received_date: row.received_date || null,
          ordered_by: row.full_name || null,
          approved_by: row.approved_by_name || null,
        })),
        shortage_cases: shortageRows.map((row) => ({
          id: row.id,
          work_order_id: row.work_order_id || null,
          shortage_qty: normalizeFloat(row.shortage_qty, null),
          required_qty: normalizeFloat(row.required_qty, null),
          available_qty: normalizeFloat(row.available_qty, null),
          unit: row.unit || null,
          status: row.status || null,
          owner_id: row.owner_id || null,
          owner_name: row.owner_name || null,
          expected_date: row.expected_date || null,
          purchase_request_no: row.purchase_request_no || null,
          priority: row.priority || null,
          last_note: row.last_note || null,
        })),
      };
    }).filter((item) => item.required_qty > 0)
      .sort((a, b) => {
        const weight = { blocked: 3, incoming: 2, ready: 1 };
        return (weight[b.risk_status] || 0) - (weight[a.risk_status] || 0)
          || Number(b.projected_shortage_qty || b.shortage_qty || 0) - Number(a.projected_shortage_qty || a.shortage_qty || 0);
      });
    const blockedItems = kitItems.filter((item) => item.risk_status === "blocked");
    const incomingItems = kitItems.filter((item) => item.risk_status === "incoming");
    const kitStatus = blockedItems.length > 0 ? "blocked" : incomingItems.length > 0 ? "incoming" : "ready";
    return {
      component_id: component.id,
      component_name: component.material_name || component.part_number || component.notes || `部件#${component.id}`,
      part_number: component.part_number || null,
      quantity: Number(component.quantity || 0),
      unit: component.unit || null,
      child_count: Math.max(scopeRows.length - 1, 0),
      leaf_count: leafRows.length,
      purchased_count: purchasedCount,
      self_made_count: selfMadeCount,
      raw_count: rawCount,
      doc_count: linkedDocs,
      missing_doc_count: Math.max(scopeRows.filter((row) => Number(row.tier) >= 1).length - linkedDocs, 0),
      total_cost: round2(Number(costMap.get(Number(component.id))?.cost || 0)),
      process_status: statusType(missing),
      process_missing: missing,
      process_operation_count: processOps.length,
      process_hours: round2(totalProcessHours),
      process_man_hours: round2(totalStandardManHours),
      bom_operation_bound_count: bomBoundCount,
      workstation_count: new Set(processOps.map((op) => op.required_workstation_id).filter(Boolean)).size,
      kit_status: kitStatus,
      kit_shortage_count: blockedItems.length + incomingItems.length,
      kit_blocked_count: blockedItems.length,
      kit_incoming_count: incomingItems.length,
      next_expected_date: earliestDate(kitItems.map((item) => item.next_expected_date)),
      shortage_amount: round2(kitItems.reduce((sum, item) => {
        const sampleRow = componentDemandRows.find((row) => Number(row.material_id) === Number(item.material_id)) || {};
        const unitPrice = Number(sampleRow.unit_price || 0);
        return sum + Number(item.projected_shortage_qty || item.shortage_qty || 0) * unitPrice;
      }, 0)),
      risk_items: kitItems.filter((item) => item.risk_status !== "ready"),
    };
  }).sort((a, b) => b.total_cost - a.total_cost);

  const processComponents = assemblyComponents.map((component) => ({
    component_id: component.component_id,
    component_name: component.component_name,
    part_number: component.part_number,
    process_status: component.process_status,
    missing: component.process_missing,
    operation_count: component.process_operation_count,
    estimated_hours: component.process_hours,
    standard_man_hours: component.process_man_hours,
    workstation_count: component.workstation_count,
    bom_operation_bound_count: component.bom_operation_bound_count,
  }));

  return {
    assemblyComponents,
    processComponents,
  };
}

module.exports = { buildAssemblyView };
