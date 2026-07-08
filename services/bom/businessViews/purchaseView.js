"use strict";

function buildPurchaseView(ctx) {
  const {
    rows,
    PURCHASED_CATEGORIES,
    normalizeBool,
    normalizeFloat,
    costMap,
    purchasePoByMaterial,
    purchasePoByBomNode,
    round2,
    round3,
    uniqText,
    earliestDate,
  } = ctx;

  const purchaseSource = rows.filter((row) => Number(row.tier) >= 2 && PURCHASED_CATEGORIES.has(row.category) && !normalizeBool(row.is_phantom));
  const purchaseGroups = new Map();
  for (const row of purchaseSource) {
    const key = row.material_id
      ? `mat:${row.material_id}`
      : `pn:${row.part_number || row.id}`;
    if (!purchaseGroups.has(key)) {
      purchaseGroups.set(key, {
        key,
        material_id: row.material_id || null,
        material_code: row.material_code || null,
        material_name: row.material_name || null,
        part_number: row.part_number || null,
        spec: row.spec || null,
        category: row.category || null,
        unit: row.unit || row.m_unit || null,
        brand_recommend: row.brand_recommend || null,
        brand_grade: row.brand_grade || null,
        quantity: 0,
        estimated_amount: 0,
        missing_price: 0,
        bom_refs: [],
      });
    }
    const group = purchaseGroups.get(key);
    group.quantity += Number(row.quantity || 0);
    group.estimated_amount += Number(costMap.get(Number(row.id))?.self || 0);
    if (normalizeFloat(row.unit_price, null) === null) group.missing_price += 1;
    group.bom_refs.push({
      bom_id: row.id,
      parent_id: row.parent_id,
      quantity: row.quantity,
      unit_price: row.unit_price,
    });
  }
  const purchaseItems = [...purchaseGroups.values()]
    .map((item) => ({
      ...item,
      quantity: round3(item.quantity),
      estimated_amount: round2(item.estimated_amount),
    }))
    .sort((a, b) => b.estimated_amount - a.estimated_amount);

  const purchaseContractItems = purchaseItems.map((item) => {
    const relatedRows = item.material_id
      ? (purchasePoByMaterial.get(Number(item.material_id)) || [])
      : item.bom_refs.flatMap((ref) => purchasePoByBomNode.get(Number(ref.bom_id)) || []);
    const orderedQty = relatedRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const receivedQty = relatedRows.reduce((sum, row) => sum + Number(row.received_qty || 0), 0);
    const openQty = relatedRows.reduce((sum, row) => sum + Math.max(Number(row.quantity || 0) - Number(row.received_qty || 0), 0), 0);
    const pricedRows = relatedRows.filter((row) => normalizeFloat(row.unit_price, null) !== null && Number(row.quantity || 0) > 0);
    const pricedQty = pricedRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const weightedUnitPrice = pricedQty > 0
      ? pricedRows.reduce((sum, row) => sum + Number(row.unit_price || 0) * Number(row.quantity || 0), 0) / pricedQty
      : null;
    const estimatedUnitPrice = item.quantity > 0 ? Number(item.estimated_amount || 0) / Number(item.quantity || 0) : null;
    const actualTotal = weightedUnitPrice !== null ? weightedUnitPrice * Number(item.quantity || 0) : null;
    const diffAmount = actualTotal !== null ? actualTotal - Number(item.estimated_amount || 0) : null;
    const status = weightedUnitPrice === null
      ? "no_contract"
      : weightedUnitPrice <= Number(estimatedUnitPrice || 0)
        ? "on_or_under_budget"
        : weightedUnitPrice > Number(estimatedUnitPrice || 0) * 1.2
          ? "over_20pct"
          : "over_budget";
    return {
      key: item.key,
      material_id: item.material_id,
      material_code: item.material_code,
      material_name: item.material_name,
      part_number: item.part_number,
      category: item.category,
      brand_recommend: item.brand_recommend,
      quantity: item.quantity,
      unit: item.unit,
      estimated_unit_price: estimatedUnitPrice !== null ? round2(estimatedUnitPrice) : null,
      estimated_amount: round2(item.estimated_amount),
      actual_unit_price: weightedUnitPrice !== null ? round2(weightedUnitPrice) : null,
      actual_amount: actualTotal !== null ? round2(actualTotal) : null,
      diff_amount: diffAmount !== null ? round2(diffAmount) : null,
      ordered_qty: round3(orderedQty),
      received_qty: round3(receivedQty),
      open_qty: round3(openQty),
      supplier_names: uniqText(relatedRows.map((row) => row.supplier_name)),
      po_nos: uniqText(relatedRows.map((row) => row.po_no)),
      next_expected_date: earliestDate(relatedRows
        .filter((row) => Math.max(Number(row.quantity || 0) - Number(row.received_qty || 0), 0) > 0)
        .map((row) => row.expected_date)),
      po_line_count: relatedRows.length,
      diff_status: status,
    };
  }).sort((a, b) => {
    const weight = { no_contract: 4, over_20pct: 3, over_budget: 2, on_or_under_budget: 1 };
    return (weight[b.diff_status] || 0) - (weight[a.diff_status] || 0)
      || Math.abs(Number(b.diff_amount || 0)) - Math.abs(Number(a.diff_amount || 0));
  });

  return {
    purchaseItems,
    purchaseContractItems,
  };
}

module.exports = { buildPurchaseView };
