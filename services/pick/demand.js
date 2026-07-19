"use strict";

const {
  DEFAULT_LOCATION,
  EPSILON,
  dbAll,
  loadWorkOrder,
  roundQty,
  workOrderMultiplier,
} = require("./shared");

function loadBomDemandRows(db, equipmentInstanceId) {
  return dbAll(
    db,
    `SELECT ib.id AS bom_id, ib.material_id, ib.quantity, ib.unit, ib.scrap_factor,
            ib.tier, ib.part_number, ib.category, ib.storage_location,
            m.material_code, m.material_name, m.spec
     FROM instance_bom ib
     LEFT JOIN materials m ON ib.material_id = m.id
     WHERE ib.equipment_instance_id = ? AND ib.tier > 0
       AND ib.is_phantom = 0 AND ib.is_alternative = 0
       AND ib.material_id IS NOT NULL
     ORDER BY ib.tier, ib.id`,
    equipmentInstanceId,
  );
}

function aggregateDemandRows(bomRows, multiplier) {
  const demandMap = {};
  for (const row of bomRows) {
    const key = row.material_id;
    if (!demandMap[key]) {
      demandMap[key] = {
        material_id: row.material_id,
        material_code: row.material_code || "N/A",
        material_name: row.material_name || row.part_number || "未知",
        spec: row.spec || "",
        unit: row.unit || "件",
        bom_qty: 0,
        storage_location: row.storage_location || DEFAULT_LOCATION,
        bom_nodes: [],
      };
    }
    const quantity = Number(row.quantity || 0) * Number(row.scrap_factor || 1) * multiplier;
    demandMap[key].bom_qty += quantity;
    demandMap[key].bom_nodes.push({
      bom_id: row.bom_id,
      tier: row.tier,
      part_number: row.part_number,
      qty_per: row.quantity,
      work_order_multiplier: multiplier,
      category: row.category,
    });
  }
  return demandMap;
}

function getNetPickedMap(db, workOrderId, materialIds) {
  if (!materialIds.length) return {};
  const placeholders = materialIds.map(() => "?").join(",");
  const rows = dbAll(
    db,
    `SELECT ml.material_id,
            SUM(CASE
              WHEN mm.movement_type = 'issue' THEN mm.quantity
              WHEN mm.movement_type = 'return' THEN -mm.quantity
              ELSE 0
            END) AS net_picked_qty
     FROM material_movements mm
     JOIN material_lots ml ON mm.material_lot_id = ml.id
     WHERE mm.work_order_id = ? AND mm.movement_type IN ('issue', 'return')
       AND ml.material_id IN (${placeholders})
     GROUP BY ml.material_id`,
    [workOrderId, ...materialIds],
  );
  const pickedMap = {};
  for (const row of rows) pickedMap[row.material_id] = Math.max(0, Number(row.net_picked_qty || 0));
  return pickedMap;
}

function getStockLotsMap(db, materialIds) {
  if (!materialIds.length) return {};
  const placeholders = materialIds.map(() => "?").join(",");
  const rows = dbAll(
    db,
    `SELECT ml.material_id, ml.id AS lot_id, ml.lot_no, ml.supplier, ml.heat_no,
            ml.received_date, i.id AS inventory_id, i.location, i.quantity AS available_qty, i.unit
     FROM inventory i
     JOIN material_lots ml ON i.material_lot_id = ml.id
     WHERE ml.material_id IN (${placeholders}) AND i.status = 'available' AND i.quantity > 0
     ORDER BY ml.material_id, COALESCE(ml.received_date, ''), ml.id, i.id`,
    materialIds,
  );
  const stockMap = {};
  for (const row of rows) {
    if (!stockMap[row.material_id]) stockMap[row.material_id] = [];
    stockMap[row.material_id].push({
      lot_id: row.lot_id,
      lot_no: row.lot_no,
      supplier: row.supplier,
      heat_no: row.heat_no,
      received_date: row.received_date,
      inventory_id: row.inventory_id,
      location: row.location,
      qty: Number(row.available_qty || 0),
      unit: row.unit,
    });
  }
  return stockMap;
}

function suggestAllocations(stockLots, requiredQty, preferredLocation) {
  let remaining = Number(requiredQty || 0);
  const sorted = [...(stockLots || [])].sort((first, second) => {
    const preferredFirst = first.location === preferredLocation ? 0 : 1;
    const preferredSecond = second.location === preferredLocation ? 0 : 1;
    if (preferredFirst !== preferredSecond) return preferredFirst - preferredSecond;
    return String(first.received_date || "").localeCompare(String(second.received_date || "")) || first.lot_id - second.lot_id;
  });
  const allocations = [];
  for (const lot of sorted) {
    if (remaining <= EPSILON) break;
    const quantity = Math.min(remaining, Number(lot.qty || 0));
    if (quantity <= EPSILON) continue;
    allocations.push({
      lot_id: lot.lot_id,
      lot_no: lot.lot_no,
      location: lot.location,
      quantity: roundQty(quantity),
      available_qty: roundQty(lot.qty),
      received_date: lot.received_date,
      supplier: lot.supplier,
      heat_no: lot.heat_no,
    });
    remaining -= quantity;
  }
  return allocations;
}

function getReturnableLots(db, workOrderId) {
  return dbAll(
    db,
    `SELECT ml.id AS lot_id, ml.material_id, ml.lot_no, ml.supplier, ml.heat_no,
            m.material_code, m.material_name, ml.unit,
            SUM(CASE
              WHEN mm.movement_type = 'issue' THEN mm.quantity
              WHEN mm.movement_type = 'return' THEN -mm.quantity
              ELSE 0
            END) AS returnable_qty
     FROM material_movements mm
     JOIN material_lots ml ON mm.material_lot_id = ml.id
     JOIN materials m ON ml.material_id = m.id
     WHERE mm.work_order_id = ? AND mm.movement_type IN ('issue', 'return')
     GROUP BY ml.id, ml.material_id, ml.lot_no, ml.supplier, ml.heat_no, m.material_code, m.material_name, ml.unit
     HAVING returnable_qty > 0
     ORDER BY m.material_code, ml.lot_no`,
    workOrderId,
  ).map((row) => ({ ...row, returnable_qty: roundQty(row.returnable_qty) }));
}

function buildPickList(db, workOrderId) {
  const workOrder = loadWorkOrder(db, workOrderId);
  const multiplier = workOrderMultiplier(workOrder);
  const bomRows = loadBomDemandRows(db, workOrder.equipment_instance_id);
  if (!bomRows.length) {
    return { wo_id: workOrder.id, wo_code: workOrder.wo_code, wo_title: workOrder.title, work_order_qty: multiplier, items: [], total_qty: 0 };
  }

  const demandMap = aggregateDemandRows(bomRows, multiplier);
  const demandIds = Object.keys(demandMap).map(Number);
  const pickedMap = getNetPickedMap(db, workOrder.id, demandIds);
  const stockMap = getStockLotsMap(db, demandIds);
  const returnableLots = getReturnableLots(db, workOrder.id);

  const items = Object.entries(demandMap).map(([materialId, demand]) => {
    const numericMaterialId = Number(materialId);
    const alreadyPicked = pickedMap[numericMaterialId] || 0;
    const remaining = Math.max(0, demand.bom_qty - alreadyPicked);
    const stockLots = stockMap[numericMaterialId] || [];
    const totalAvailable = stockLots.reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
    const suggestedAllocations = suggestAllocations(stockLots, remaining, demand.storage_location);
    const suggestedPickQty = suggestedAllocations.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);

    return {
      material_id: numericMaterialId,
      material_code: demand.material_code,
      material_name: demand.material_name,
      spec: demand.spec,
      unit: demand.unit,
      bom_required: roundQty(demand.bom_qty),
      already_picked: roundQty(alreadyPicked),
      remaining: roundQty(remaining),
      available_qty: roundQty(totalAvailable),
      suggested_pick_qty: roundQty(suggestedPickQty),
      storage_location: demand.storage_location,
      status: remaining <= EPSILON ? "done"
        : totalAvailable <= EPSILON ? "empty"
        : totalAvailable + EPSILON < remaining ? "short"
        : "ready",
      stock_locations: stockLots.slice(0, 8).map((lot) => ({ ...lot, qty: roundQty(lot.qty) })),
      suggested_allocations: suggestedAllocations,
      bom_nodes: demand.bom_nodes.slice(0, 3),
    };
  });

  const totalQty = items.reduce((sum, item) => sum + item.bom_required, 0);
  const doneCount = items.filter((item) => item.status === "done").length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const shortCount = items.filter((item) => item.status === "short" || item.status === "empty").length;
  const statusOrder = { empty: 0, short: 1, ready: 2, done: 3 };

  return {
    wo_id: workOrder.id,
    wo_code: workOrder.wo_code,
    wo_title: workOrder.title,
    work_order_qty: multiplier,
    total_items: items.length,
    done_items: doneCount,
    ready_items: readyCount,
    short_items: shortCount,
    total_bom_qty: roundQty(totalQty),
    returnable_lots: returnableLots,
    items: items.sort((first, second) => statusOrder[first.status] - statusOrder[second.status]),
  };
}

function remainingForMaterial(db, workOrderId, materialId) {
  const pickList = buildPickList(db, workOrderId);
  const row = pickList.items.find((item) => Number(item.material_id) === Number(materialId));
  return row ? Number(row.remaining || 0) : 0;
}

function allocateLots(db, materialId, quantity, preferredLocation) {
  const numericMaterialId = Number(materialId);
  const stockMap = getStockLotsMap(db, [numericMaterialId]);
  const allocations = suggestAllocations(stockMap[numericMaterialId] || [], quantity, preferredLocation || DEFAULT_LOCATION);
  const total = allocations.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
  if (total + EPSILON < Number(quantity || 0)) {
    throw new Error(`库存不足: 可分配 ${roundQty(total)}, 要领 ${roundQty(quantity)}`);
  }
  return allocations;
}

module.exports = {
  allocateLots,
  buildPickList,
  getReturnableLots,
  remainingForMaterial,
};
