"use strict";

const {
  loadDocuments,
  loadInventoryRows,
  loadProcessNodes,
  loadPurchaseOrderRows,
  loadShortageRows,
} = require("./dataSources");

function groupByNumericKey(rows, key, normalizeInt) {
  const groups = new Map();
  for (const row of rows) {
    const id = normalizeInt(row[key], null);
    if (!id) continue;
    const items = groups.get(id) || [];
    items.push(row);
    groups.set(id, items);
  }
  return groups;
}

function createPurchaseIndexes(rows, normalizeInt, earliestDate) {
  const purchasePoByMaterial = groupByNumericKey(rows, "material_id", normalizeInt);
  const purchasePoByBomNode = groupByNumericKey(rows, "bom_node_id", normalizeInt);
  const inboundByMaterial = new Map();
  for (const row of rows) {
    const materialId = normalizeInt(row.material_id, null);
    if (!materialId) continue;
    const openQty = Math.max(Number(row.quantity || 0) - Number(row.received_qty || 0), 0);
    const bucket = inboundByMaterial.get(materialId) || { open_qty: 0, next_expected_date: null, po_nos: [] };
    bucket.open_qty += openQty;
    if (openQty > 0) {
      bucket.next_expected_date = earliestDate([bucket.next_expected_date, row.expected_date]);
      if (row.po_no) bucket.po_nos.push(row.po_no);
    }
    inboundByMaterial.set(materialId, bucket);
  }
  return { purchasePoByMaterial, purchasePoByBomNode, inboundByMaterial };
}

function createDemandMap(rows, purchasedCategories, normalizeBool, normalizeInt) {
  const demand = new Map();
  for (const row of rows) {
    if (normalizeBool(row.is_phantom)) continue;
    const materialId = normalizeInt(row.material_id, null);
    if (!materialId || (!purchasedCategories.has(row.category) && Number(row.tier) !== 3)) continue;
    demand.set(materialId, Number(demand.get(materialId) || 0) + Number(row.quantity || 0));
  }
  return demand;
}

function loadBomRows(db, instanceId, rowsArg) {
  if (rowsArg) return rowsArg;
  return db.prepare(`
    SELECT b.*, m.material_code, m.material_name, m.spec, m.unit AS m_unit
    FROM instance_bom b
    LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.equipment_instance_id = ?
    ORDER BY b.tier, b.parent_id, b.id
  `).all(instanceId);
}

function loadBusinessViewContext({ db, instanceId, rowsArg, deps }) {
  const rows = loadBomRows(db, instanceId, rowsArg);
  const childMap = deps.buildChildrenMap(rows);
  const costMap = new Map(deps.calcCost(db, instanceId).map((item) => [Number(item.id), item]));
  const roots = rows.filter((row) => Number(row.tier) === 0 && (row.parent_id === null || Number(row.parent_id) === 0));
  const totalCost = roots.reduce((sum, row) => sum + Number(costMap.get(Number(row.id))?.cost || 0), 0);
  const docMap = groupByNumericKey(loadDocuments(db, deps.tableExists), "bom_node_id", deps.normalizeInt);
  const processNodes = loadProcessNodes(db, instanceId, deps.tableExists);
  const inventoryRows = loadInventoryRows(db, deps.hasColumns);
  const stockMap = new Map(inventoryRows.map((row) => [Number(row.material_id), Number(row.available_qty || 0)]));
  const purchaseOrderRows = loadPurchaseOrderRows(db, instanceId, deps.tableColumns);
  const purchaseIndexes = createPurchaseIndexes(purchaseOrderRows, deps.normalizeInt, deps.earliestDate);
  const shortageRows = loadShortageRows(db, instanceId, deps.tableColumns);
  const shortageByMaterial = groupByNumericKey(shortageRows.filter((row) => deps.isActiveShortageStatus(row.status)), "material_id", deps.normalizeInt);
  const resolvedShortageByMaterial = groupByNumericKey(shortageRows.filter((row) => deps.isResolvedShortageStatus(row.status)), "material_id", deps.normalizeInt);

  return {
    rows,
    childMap,
    costMap,
    totalCost,
    docMap,
    processNodes,
    stockMap,
    totalDemandMap: createDemandMap(rows, deps.PURCHASED_CATEGORIES, deps.normalizeBool, deps.normalizeInt),
    shortageByMaterial,
    resolvedShortageByMaterial,
    ...purchaseIndexes,
  };
}

module.exports = { loadBusinessViewContext };
