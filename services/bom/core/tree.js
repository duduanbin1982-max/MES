"use strict";

const { normalizeFloat, normalizeInt } = require("./utils");

function tierSummary(rows) {
  const summary = { 0: 0, 1: 0, 2: 0, 3: 0, total: rows.length };
  for (const row of rows) {
    const tier = Number(row.tier);
    if (tier >= 0 && tier <= 3) summary[tier] += 1;
  }
  return summary;
}

function buildTree(rows) {
  const byId = new Map();
  const roots = [];
  for (const row of rows) {
    byId.set(Number(row.id), {
      ...row,
      quantity: normalizeFloat(row.quantity, 0),
      children: [],
      label: row.material_name || row.part_number || row.material_code || `BOM#${row.id}`,
    });
  }
  for (const row of byId.values()) {
    const parentId = normalizeInt(row.parent_id, null);
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(row);
    else roots.push(row);
  }
  return roots;
}

module.exports = {
  tierSummary,
  buildTree,
};
