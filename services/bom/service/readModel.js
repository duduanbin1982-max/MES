"use strict";

const { buildTree, tierSummary, structureSummary } = require("../core");

function bomColumns(db) {
  try { return new Set(db.prepare("PRAGMA table_info(instance_bom)").all().map((column) => column.name)); } catch (_error) { return new Set(); }
}

function selectBomRows(db, instanceId, bomType = "EBOM", asOf = null) {
  const columns = bomColumns(db);
  const typeClause = columns.has("bom_type") && bomType ? "AND COALESCE(b.bom_type, 'EBOM') = ?" : "";
  const dateClause = asOf ? "AND (b.effective_from IS NULL OR b.effective_from <= ?) AND (b.effective_to IS NULL OR b.effective_to >= ?)" : "";
  const params = [instanceId];
  if (typeClause) params.push(bomType);
  if (asOf) params.push(asOf, asOf);
  return db.prepare(`
    SELECT b.*, m.material_code, m.material_name, m.unit AS m_unit, m.spec
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ? ${typeClause} ${dateClause}
    ORDER BY COALESCE(b.level_code, ''), b.tier, COALESCE(b.sort_order, 0), b.id
  `).all(...params);
}

function collectSubtreeIds(allRows, rootId) {
  const ids = new Set([Number(rootId)]);
  let added = true;
  while (added) {
    added = false;
    for (const row of allRows) {
      if (row.parent_id && ids.has(Number(row.parent_id)) && !ids.has(Number(row.id))) {
        ids.add(Number(row.id));
        added = true;
      }
    }
  }
  return ids;
}

function filterBomRows(allRows, query = {}) {
  let rows = allRows;
  if (query.tier !== undefined) rows = rows.filter((row) => Number(row.tier) === Number(query.tier));
  if (query.part_id) {
    const ids = collectSubtreeIds(allRows, query.part_id);
    rows = rows.filter((row) => ids.has(Number(row.id)));
  }
  return rows;
}

function buildBomListResponse(db, instanceId, query = {}) {
  const { view = "tree", bom_type = "EBOM", as_of = null } = query;
  const allRows = selectBomRows(db, instanceId, bom_type, as_of);
  const summary = tierSummary(allRows);
  const structure = structureSummary(allRows);

  if (view === "tree") {
    const rows = query.part_id ? filterBomRows(allRows, { part_id: query.part_id }) : allRows;
    return { view: "tree", bom_type, as_of, tier_summary: summary, structure_summary: structure, tree: buildTree(rows), total: rows.length };
  }

  const flat = filterBomRows(allRows, query);
  return {
    view: "flat",
    tier_summary: summary,
    structure_summary: structure,
    items: flat,
    total: flat.length,
    tier: query.tier !== undefined ? Number(query.tier) : null,
    bom_type,
    as_of,
  };
}

function buildBomLevelsResponse(db, instanceId, bomType = "EBOM", asOf = null) {
  const rows = selectBomRows(db, instanceId, bomType, asOf);
  const levels = { 0: [], 1: [], 2: [], 3: [] };
  rows.forEach((row) => {
    const tier = Number(row.tier || 0);
    if (!levels[tier]) levels[tier] = [];
    levels[tier].push(row);
  });
  return { levels, summary: tierSummary(rows), structure_summary: structureSummary(rows), bom_type: bomType, as_of: asOf };
}

module.exports = {
  selectBomRows,
  buildBomListResponse,
  buildBomLevelsResponse,
  collectSubtreeIds,
  filterBomRows,
};
