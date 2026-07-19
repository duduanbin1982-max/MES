"use strict";

function buildRawView(ctx) {
  const {
    rows,
    costMap,
    normalizeBool,
    normalizeFloat,
    round2,
  } = ctx;

  const rawSource = rows.filter((row) => Number(row.tier) === 3 && !normalizeBool(row.is_phantom));
  const rawItems = rawSource.map((row) => ({
    bom_id: row.id,
    parent_id: row.parent_id,
    material_id: row.material_id || null,
    material_code: row.material_code || null,
    material_name: row.material_name || null,
    part_number: row.part_number || null,
    category: row.category || null,
    quantity: Number(row.quantity || 0),
    unit: row.unit || row.m_unit || null,
    material_grade: row.material_grade || null,
    surface_treatment: row.surface_treatment || null,
    scrap_factor: Number(row.scrap_factor || 1),
    weight: normalizeFloat(row.weight, null),
    unit_price: normalizeFloat(row.unit_price, null),
    estimated_amount: round2(Number(costMap.get(Number(row.id))?.self || 0)),
    notes: row.notes || null,
  })).sort((a, b) => b.estimated_amount - a.estimated_amount);

  return {
    rawItems,
    totalEstimatedAmount: round2(rawItems.reduce((sum, item) => sum + item.estimated_amount, 0)),
    totalWeight: round2(rawItems.reduce((sum, item) => sum + Number(item.weight || 0), 0)),
  };
}

module.exports = { buildRawView };
