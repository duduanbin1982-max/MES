"use strict";
const { wrap } = require('../middleware/asyncHandler');
// services/pickService.js
// P1 领料/退料工作流 (基于 BOM + 库存 + material_movements)
//   GET  /api/work_orders/:id/pick-list    生成领料单 (BOM需求 vs 库存可用)
//   POST /api/work_orders/:id/pick         执行领料 (批量出库, 事务)
//   POST /api/work_orders/:id/return       退料 (余料回库)
//   GET  /api/work_orders/:id/pick-history 领退料历史
// Author: 三狗子 | Date: 2026-06-26

const { ApiError } = require("../app/errors");
const { emit, Events } = require("../app/ws/EventBus");

const EPSILON = 0.000001;
const DEFAULT_LOCATION = "主仓库-A-01";

function roundQty(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function dbAll(db, sql, params = []) {
  return db.prepare(sql).all(Array.isArray(params) ? params : [params]);
}

function dbGet(db, sql, params = []) {
  return db.prepare(sql).get(Array.isArray(params) ? params : [params]);
}

function dbRun(db, sql, params = []) {
  return db.prepare(sql).run(Array.isArray(params) ? params : [params]);
}

function workOrderMultiplier(wo) {
  return Math.max(Number(wo.quantity_planned || wo.quantity || 1), 1);
}

function loadWorkOrder(db, workOrderId) {
  const wo = dbGet(db, "SELECT * FROM work_orders WHERE id = ?", workOrderId);
  if (!wo) throw ApiError.notFound("工单不存在");
  return wo;
}

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
    equipmentInstanceId
  );
}

function aggregateDemandRows(bomRows, multiplier) {
  const demandMap = {};
  for (const b of bomRows) {
    const key = b.material_id;
    if (!demandMap[key]) {
      demandMap[key] = {
        material_id: b.material_id,
        material_code: b.material_code || "N/A",
        material_name: b.material_name || b.part_number || "未知",
        spec: b.spec || "",
        unit: b.unit || "件",
        bom_qty: 0,
        storage_location: b.storage_location || DEFAULT_LOCATION,
        bom_nodes: [],
      };
    }
    const qty = Number(b.quantity || 0) * Number(b.scrap_factor || 1) * multiplier;
    demandMap[key].bom_qty += qty;
    demandMap[key].bom_nodes.push({
      bom_id: b.bom_id,
      tier: b.tier,
      part_number: b.part_number,
      qty_per: b.quantity,
      work_order_multiplier: multiplier,
      category: b.category,
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
    [workOrderId, ...materialIds]
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
    materialIds
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
  const sorted = [...(stockLots || [])].sort((a, b) => {
    const preferredA = a.location === preferredLocation ? 0 : 1;
    const preferredB = b.location === preferredLocation ? 0 : 1;
    if (preferredA !== preferredB) return preferredA - preferredB;
    return String(a.received_date || "").localeCompare(String(b.received_date || "")) || a.lot_id - b.lot_id;
  });
  const allocations = [];
  for (const lot of sorted) {
    if (remaining <= EPSILON) break;
    const qty = Math.min(remaining, Number(lot.qty || 0));
    if (qty <= EPSILON) continue;
    allocations.push({
      lot_id: lot.lot_id,
      lot_no: lot.lot_no,
      location: lot.location,
      quantity: roundQty(qty),
      available_qty: roundQty(lot.qty),
      received_date: lot.received_date,
      supplier: lot.supplier,
      heat_no: lot.heat_no,
    });
    remaining -= qty;
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
    workOrderId
  ).map(row => ({ ...row, returnable_qty: roundQty(row.returnable_qty) }));
}

function buildPickList(db, workOrderId) {
  const wo = loadWorkOrder(db, workOrderId);
  const multiplier = workOrderMultiplier(wo);
  const bomRows = loadBomDemandRows(db, wo.equipment_instance_id);
  if (!bomRows.length) {
    return { wo_id: wo.id, wo_code: wo.wo_code, wo_title: wo.title, work_order_qty: multiplier, items: [], total_qty: 0 };
  }

  const demandMap = aggregateDemandRows(bomRows, multiplier);
  const demandIds = Object.keys(demandMap).map(Number);
  const pickedMap = getNetPickedMap(db, wo.id, demandIds);
  const stockMap = getStockLotsMap(db, demandIds);
  const returnableLots = getReturnableLots(db, wo.id);

  const items = Object.entries(demandMap).map(([mid, d]) => {
    const midNum = Number(mid);
    const alreadyPicked = pickedMap[midNum] || 0;
    const remaining = Math.max(0, d.bom_qty - alreadyPicked);
    const stockLots = stockMap[midNum] || [];
    const totalAvail = stockLots.reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
    const suggestedAllocations = suggestAllocations(stockLots, remaining, d.storage_location);
    const suggestedPickQty = suggestedAllocations.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);

    return {
      material_id: midNum,
      material_code: d.material_code,
      material_name: d.material_name,
      spec: d.spec,
      unit: d.unit,
      bom_required: roundQty(d.bom_qty),
      already_picked: roundQty(alreadyPicked),
      remaining: roundQty(remaining),
      available_qty: roundQty(totalAvail),
      suggested_pick_qty: roundQty(suggestedPickQty),
      storage_location: d.storage_location,
      status: remaining <= EPSILON ? "done"
        : totalAvail <= EPSILON ? "empty"
        : totalAvail + EPSILON < remaining ? "short"
        : "ready",
      stock_locations: stockLots.slice(0, 8).map(lot => ({ ...lot, qty: roundQty(lot.qty) })),
      suggested_allocations: suggestedAllocations,
      bom_nodes: d.bom_nodes.slice(0, 3),
    };
  });

  const totalQty = items.reduce((sum, item) => sum + item.bom_required, 0);
  const doneCount = items.filter(item => item.status === "done").length;
  const readyCount = items.filter(item => item.status === "ready").length;
  const shortCount = items.filter(item => item.status === "short" || item.status === "empty").length;

  return {
    wo_id: wo.id,
    wo_code: wo.wo_code,
    wo_title: wo.title,
    work_order_qty: multiplier,
    total_items: items.length,
    done_items: doneCount,
    ready_items: readyCount,
    short_items: shortCount,
    total_bom_qty: roundQty(totalQty),
    returnable_lots: returnableLots,
    items: items.sort((a, b) => {
      const order = { empty: 0, short: 1, ready: 2, done: 3 };
      return (order[a.status] || 0) - (order[b.status] || 0);
    }),
  };
}

function remainingForMaterial(db, workOrderId, materialId) {
  const pickList = buildPickList(db, workOrderId);
  const row = pickList.items.find(item => Number(item.material_id) === Number(materialId));
  return row ? Number(row.remaining || 0) : 0;
}

function allocateLots(db, materialId, quantity, preferredLocation) {
  const stockMap = getStockLotsMap(db, [Number(materialId)]);
  const allocations = suggestAllocations(stockMap[Number(materialId)] || [], quantity, preferredLocation || DEFAULT_LOCATION);
  const total = allocations.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
  if (total + EPSILON < Number(quantity || 0)) {
    throw new Error(`库存不足: 可分配 ${roundQty(total)}, 要领 ${roundQty(quantity)}`);
  }
  return allocations;
}

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

function pickAllocation(db, wo, allocation, materialId, operatorId, fallbackLocation) {
  const lotId = Number(allocation.lot_id);
  const quantity = Number(allocation.quantity || 0);
  const location = allocation.location || fallbackLocation || DEFAULT_LOCATION;
  if (!lotId || quantity <= EPSILON) throw new Error("lot_id/quantity 必填且 quantity > 0");

  const lot = dbGet(db, "SELECT * FROM material_lots WHERE id = ? AND material_id = ?", [lotId, materialId]);
  if (!lot) throw new Error("批次不存在或物料不匹配");

  const inv = dbGet(
    db,
    "SELECT id, quantity FROM inventory WHERE material_lot_id = ? AND location = ? AND status = 'available'",
    [lot.id, location]
  );
  if (!inv || Number(inv.quantity || 0) + EPSILON < quantity) {
    throw new Error("库存不足: 现有 " + (inv ? roundQty(inv.quantity) : 0) + ", 要领 " + roundQty(quantity));
  }

  dbRun(db, "UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [quantity, inv.id]);
  const movement = dbRun(
    db,
    `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, work_order_id, operator_id, notes)
     VALUES (?, 'issue', ?, ?, ?, ?, ?, ?)`,
    [lot.id, quantity, lot.unit || "件", location, wo.id, operatorId, "领料: WO-" + wo.wo_code]
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
  const wo = loadWorkOrder(db, workOrderId);
  const { items, operator_id, location, allow_over_pick } = body || {};
  if (!Array.isArray(items) || !items.length) {
    throw ApiError.validation("items 数组必填, 格式: [{material_id, quantity, lot_id?}]");
  }
  const opId = operator_id || (user && (user.sub || user.uid || user.id)) || null;
  const loc = location || DEFAULT_LOCATION;
  const results = [];
  const errors = [];

  const tx = db.transaction(() => {
    for (const item of items) {
      try {
        const normalized = normalizePickItem(item, loc);
        if (!normalized.materialId || normalized.requestedQty <= EPSILON) {
          errors.push({ material_id: item.material_id, error: "material_id/quantity 必填且 quantity > 0" });
          continue;
        }
        const remaining = remainingForMaterial(db, wo.id, normalized.materialId);
        if (!allow_over_pick && normalized.requestedQty > remaining + EPSILON) {
          errors.push({
            material_id: normalized.materialId,
            error: "领料数量超过工单剩余需求: 剩余 " + roundQty(remaining) + ", 要领 " + roundQty(normalized.requestedQty),
          });
          continue;
        }

        const allocations = normalized.allocations.length
          ? normalized.allocations
          : allocateLots(db, normalized.materialId, normalized.requestedQty, item.location || loc);
        for (const allocation of allocations) {
          results.push(pickAllocation(db, wo, allocation, normalized.materialId, opId, item.location || loc));
        }
      } catch (error) {
        errors.push({ material_id: item.material_id, error: error.message });
      }
    }
  });

  tx();
  return { wo, results, errors, operator_id: opId };
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
    [workOrderId, lotId]
  );
  return Math.max(0, Number(row?.qty || 0));
}

function executeReturn(db, workOrderId, body, user) {
  const wo = loadWorkOrder(db, workOrderId);
  const { items, operator_id, location, reason, allow_over_return } = body || {};
  if (!Array.isArray(items) || !items.length) {
    throw ApiError.validation("items 数组必填, 格式: [{lot_id, quantity, reason}]");
  }
  const opId = operator_id || (user && (user.sub || user.uid || user.id)) || null;
  const loc = location || DEFAULT_LOCATION;
  const results = [];
  const errors = [];

  const tx = db.transaction(() => {
    for (const item of items) {
      try {
        const lotId = Number(item.lot_id);
        const quantity = Number(item.quantity || 0);
        if (!lotId || quantity <= EPSILON) {
          errors.push({ lot_id: item.lot_id, error: "lot_id/quantity 必填且 quantity > 0" });
          continue;
        }
        const returnableQty = returnableQtyByLot(db, wo.id, lotId);
        if (!allow_over_return && quantity > returnableQty + EPSILON) {
          errors.push({ lot_id: lotId, error: "退料数量超过可退数量: 可退 " + roundQty(returnableQty) + ", 要退 " + roundQty(quantity) });
          continue;
        }

        const lot = dbGet(db, "SELECT * FROM material_lots WHERE id = ?", lotId);
        if (!lot) {
          errors.push({ lot_id: lotId, error: "批次不存在" });
          continue;
        }

        const existing = dbGet(db, "SELECT id FROM inventory WHERE material_lot_id = ? AND location = ?", [lotId, loc]);
        if (existing) {
          dbRun(db, "UPDATE inventory SET quantity = quantity + ?, status = 'available', last_updated = datetime('now') WHERE id = ?", [quantity, existing.id]);
        } else {
          dbRun(db, "INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')",
            [lotId, loc, quantity, lot.unit || "件"]);
        }

        const movement = dbRun(
          db,
          `INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, operator_id, notes)
           VALUES (?, 'return', ?, ?, ?, ?, ?, ?)`,
          [lotId, quantity, lot.unit || "件", loc, wo.id, opId, (item.reason || reason || "退料") + " WO-" + wo.wo_code]
        );

        results.push({
          movement_id: Number(movement.lastInsertRowid),
          lot_id: lotId,
          lot_no: lot.lot_no,
          quantity: roundQty(quantity),
          location: loc,
          reason: item.reason || reason || "",
        });
      } catch (error) {
        errors.push({ lot_id: item.lot_id, error: error.message });
      }
    }
  });

  tx();
  return { wo, results, errors, operator_id: opId };
}

function register(app, db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);

  // ====== 1. 生成领料单 ======
  app.get("/api/work_orders/:id/pick-list", wrap((req, res) => {
    res.json(buildPickList(db, req.params.id));
  }));

  // ====== 2. 执行领料 (批量出库) ======
  app.post("/api/work_orders/:id/pick", wrap((req, res) => {
    const { wo, results, errors, operator_id: opId } = executePick(db, req.params.id, req.body, req.user);

    if (results.length) {
      emit(Events.INVENTORY_LOW, {
        wo_id: wo.id,
        wo_code: wo.wo_code,
        picked_items: results.length,
        operator_id: opId,
      });
    }

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      picked: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  // ====== 3. 退料 (余料回库) ======
  app.post("/api/work_orders/:id/return", wrap((req, res) => {
    const { wo, results, errors } = executeReturn(db, req.params.id, req.body, req.user);

    res.json({
      wo_id: wo.id,
      wo_code: wo.wo_code,
      returned: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  // ====== 4. 领退料历史 ======
  app.get("/api/work_orders/:id/pick-history", wrap((req, res) => {
    const wo = get("SELECT id, wo_code FROM work_orders WHERE id = ?", req.params.id);
    if (!wo) throw ApiError.notFound("工单不存在")

    const rows = all(
      `SELECT mm.id, mm.movement_type, mm.quantity, mm.unit, mm.from_location, mm.to_location,
              mm.notes, mm.created_at,
              ml.lot_no, ml.supplier, ml.heat_no,
              m.material_code, m.material_name,
              u.full_name AS operator_name
       FROM material_movements mm
       JOIN material_lots ml ON mm.material_lot_id = ml.id
       JOIN materials m ON ml.material_id = m.id
       LEFT JOIN users u ON mm.operator_id = u.id
       WHERE mm.work_order_id = ? AND mm.movement_type IN ('issue', 'return')
       ORDER BY mm.created_at DESC`,
      wo.id
    );

    // 汇总
    const summary = { issue: { count: 0, total_qty: 0 }, return: { count: 0, total_qty: 0 } };
    for (const r of rows) {
      if (r.movement_type === "issue") { summary.issue.count++; summary.issue.total_qty += Number(r.quantity || 0); }
      else if (r.movement_type === "return") { summary.return.count++; summary.return.total_qty += Number(r.quantity || 0); }
    }
    summary.issue.total_qty = roundQty(summary.issue.total_qty);
    summary.return.total_qty = roundQty(summary.return.total_qty);

    res.json({ work_order: wo, summary, movements: rows, returnable_lots: getReturnableLots(db, wo.id), count: rows.length });
  }));
}

module.exports = {
  register,
  buildPickList,
  executePick,
  executeReturn,
  getReturnableLots,
  remainingForMaterial,
  returnableQtyByLot,
};
