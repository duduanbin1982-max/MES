"use strict";

function buildCostView(ctx) {
  const {
    rows,
    costMap,
    normalizeBool,
    normalizeFloat,
    round2,
  } = ctx;

  const categoryCostMap = new Map();
  for (const row of rows.filter((item) => Number(item.tier) >= 2 && !normalizeBool(item.is_phantom))) {
    const key = row.category || "未分类";
    if (!categoryCostMap.has(key)) categoryCostMap.set(key, { category: key, node_count: 0, estimated_amount: 0, missing_price: 0 });
    const bucket = categoryCostMap.get(key);
    bucket.node_count += 1;
    bucket.estimated_amount += Number(costMap.get(Number(row.id))?.self || 0);
    if (normalizeFloat(row.unit_price, null) === null) bucket.missing_price += 1;
  }

  const byCategory = [...categoryCostMap.values()]
    .map((item) => ({ ...item, estimated_amount: round2(item.estimated_amount) }))
    .sort((a, b) => b.estimated_amount - a.estimated_amount);

  const topItems = rows
    .filter((row) => Number(row.tier) >= 2 && !normalizeBool(row.is_phantom))
    .map((row) => ({
      bom_id: row.id,
      material_code: row.material_code || null,
      material_name: row.material_name || null,
      part_number: row.part_number || null,
      category: row.category || null,
      tier: row.tier,
      self_cost: round2(Number(costMap.get(Number(row.id))?.self || 0)),
      quantity: Number(row.quantity || 0),
      unit: row.unit || null,
      unit_price: normalizeFloat(row.unit_price, null),
    }))
    .sort((a, b) => b.self_cost - a.self_cost)
    .slice(0, 20);

  return {
    byCategory,
    topItems,
    missingPriceCount: rows.filter((row) => Number(row.tier) >= 2 && !normalizeBool(row.is_phantom) && normalizeFloat(row.unit_price, null) === null).length,
  };
}

module.exports = { buildCostView };
