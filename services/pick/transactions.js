"use strict";

const { ApiError } = require("../../app/errors");
const { allocateLots, remainingForMaterial } = require("./demand");
const {
  DEFAULT_LOCATION,
  EPSILON,
  dbGet,
  dbRun,
  loadWorkOrder,
  roundQty,
} = require("./shared");

function normalizePickItem(item, fallbackLocation) {
  const materialId = Number(item.material_id);
  const allocations = Array.isArray(item.allocations) && item.allocations.length
    ? item.allocations
    : item.lot_id
      ? [{ lot_id: item.lot_id, quantity: item.quantity, location: item.location || fallbackLocation }]
      : [];
  const requestedQty = allocations.length
    ? allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
    : Number(item.quantity || 0);
  return { materialId, requestedQty, allocations };
}

function pickAllocation(db, workOrder, allocation, materialId, operatorId, fallbackLocation) {
  const lotId = Number(allocation.lot_id);
  const quantity = Number(allocation.quantity || 0);
  const location = allocation.location || fallbackLocation || DEFAULT_LOCATION;
  if (!lotId || quantity <= EPSILON) throw new Error("lot_id/quantity 必填且 quantity > 0");

  const lot = dbGet(db, "SELECT * FROM material_lots WHERE id = ? AND material_id = ?", [lotId, materialId]);
  if (!lot) throw new Error("批次不存在或物料不匹配");

  const inventory = dbGet(
    db,
    "SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'",
    [lot.id, location],
  );
  if (!inventory || Number(inventory.quantity || 0) + EPSILON < quantity) {
    throw new Error("库存不足: 现有 " + (inventory ? roundQty(inventory.quantity) : 0) + ", 要领 " + roundQty(quantity));
  }

  dbRun(db, "UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [quantity, inventory.id]);
  const movement = dbRun(
    db,
    `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, work_order_id, operator_id, notes)
     VALUES (?, 'issue', ?, ?, ?, ?, ?, ?)`,
    [lot.id, quantity, lot.unit || "件", location, workOrder.id, operatorId, "领料: WO-" + workOrder.wo_code],
  );

  return {
    movement_id: Number(movement.lastInsertRowid),
    material_id: materialId,
    lot_id: lot.id,
    lot_no: lot.lot_no,
    quantity: roundQty(quantity),
    location,
  };
}

function executePick(db, workOrderId, body, user) {
  const workOrder = loadWorkOrder(db, workOrderId);
  const { items, operator_id, location, allow_over_pick } = body || {};
  if (!Array.isArray(items) || !items.length) {
    throw ApiError.validation("items 数组必填, 格式: [{material_id, quantity, lot_id?}]");
  }
  const operatorId = operator_id || (user && (user.sub || user.uid || user.id)) || null;
  const defaultLocation = location || DEFAULT_LOCATION;
  const results = [];
  const errors = [];

  const transaction = db.transaction(() => {
    for (const item of items) {
      try {
        const normalized = normalizePickItem(item, defaultLocation);
        if (!normalized.materialId || normalized.requestedQty <= EPSILON) {
          errors.push({ material_id: item.material_id, error: "material_id/quantity 必填且 quantity > 0" });
          continue;
        }
        const remaining = remainingForMaterial(db, workOrder.id, normalized.materialId);
        if (!allow_over_pick && normalized.requestedQty > remaining + EPSILON) {
          errors.push({
            material_id: normalized.materialId,
            error: "领料数量超过工单剩余需求: 剩余 " + roundQty(remaining) + ", 要领 " + roundQty(normalized.requestedQty),
          });
          continue;
        }

        const allocations = normalized.allocations.length
          ? normalized.allocations
          : allocateLots(db, normalized.materialId, normalized.requestedQty, item.location || defaultLocation);
        for (const allocation of allocations) {
          results.push(pickAllocation(db, workOrder, allocation, normalized.materialId, operatorId, item.location || defaultLocation));
        }
      } catch (error) {
        errors.push({ material_id: item.material_id, error: error.message });
      }
    }
  });

  transaction();
  return { wo: workOrder, results, errors, operator_id: operatorId };
}

function returnableQtyByLot(db, workOrderId, lotId) {
  const row = dbGet(
    db,
    `SELECT SUM(CASE
       WHEN movement_type = 'issue' THEN quantity
       WHEN movement_type = 'return' THEN -quantity
       ELSE 0
     END) AS qty
     FROM material_movements
     WHERE work_order_id = ? AND material_lot_id = ? AND movement_type IN ('issue', 'return')`,
    [workOrderId, lotId],
  );
  return Math.max(0, Number(row?.qty || 0));
}

function executeReturn(db, workOrderId, body, user) {
  const workOrder = loadWorkOrder(db, workOrderId);
  const { items, operator_id, location, reason, allow_over_return } = body || {};
  if (!Array.isArray(items) || !items.length) {
    throw ApiError.validation("items 数组必填, 格式: [{lot_id, quantity, reason}]");
  }
  const operatorId = operator_id || (user && (user.sub || user.uid || user.id)) || null;
  const defaultLocation = location || DEFAULT_LOCATION;
  const results = [];
  const errors = [];

  const transaction = db.transaction(() => {
    for (const item of items) {
      try {
        const lotId = Number(item.lot_id);
        const quantity = Number(item.quantity || 0);
        if (!lotId || quantity <= EPSILON) {
          errors.push({ lot_id: item.lot_id, error: "lot_id/quantity 必填且 quantity > 0" });
          continue;
        }
        const returnableQty = returnableQtyByLot(db, workOrder.id, lotId);
        if (!allow_over_return && quantity > returnableQty + EPSILON) {
          errors.push({ lot_id: lotId, error: "退料数量超过可退数量: 可退 " + roundQty(returnableQty) + ", 要退 " + roundQty(quantity) });
          continue;
        }

        const lot = dbGet(db, "SELECT * FROM material_lots WHERE id = ?", lotId);
        if (!lot) {
          errors.push({ lot_id: lotId, error: "批次不存在" });
          continue;
        }

        const existing = dbGet(db, "SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?", [lotId, defaultLocation]);
        if (existing) {
          dbRun(db, "UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [quantity, existing.id]);
        } else {
          dbRun(
            db,
            "INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')",
            [lotId, defaultLocation, quantity, lot.unit || "件"],
          );
        }

        const movement = dbRun(
          db,
          `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, operator_id, notes)
           VALUES (?, 'return', ?, ?, ?, ?, ?, ?)`,
          [lotId, quantity, lot.unit || "件", defaultLocation, workOrder.id, operatorId, (item.reason || reason || "退料") + " WO-" + workOrder.wo_code],
        );

        results.push({
          movement_id: Number(movement.lastInsertRowid),
          lot_id: lotId,
          lot_no: lot.lot_no,
          quantity: roundQty(quantity),
          location: defaultLocation,
          reason: item.reason || reason || "",
        });
      } catch (error) {
        errors.push({ lot_id: item.lot_id, error: error.message });
      }
    }
  });

  transaction();
  return { wo: workOrder, results, errors, operator_id: operatorId };
}

module.exports = { executePick, executeReturn, returnableQtyByLot };
