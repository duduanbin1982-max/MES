"use strict";

const { ApiError } = require("../../app/errors");
const { emit, Events } = require("../../app/ws/EventBus");
const { wrap } = require("../../middleware/asyncHandler");
const { buildPickList, getReturnableLots } = require("./demand");
const { dbAll, dbGet, roundQty } = require("./shared");
const { executePick, executeReturn } = require("./transactions");

function registerPickRoutes(app, db) {
  app.get("/api/work_orders/:id/pick-list", wrap((request, response) => {
    response.json(buildPickList(db, request.params.id));
  }));

  app.post("/api/work_orders/:id/pick", wrap((request, response) => {
    const { wo: workOrder, results, errors, operator_id: operatorId } = executePick(db, request.params.id, request.body, request.user);
    if (results.length) {
      emit(Events.INVENTORY_LOW, {
        wo_id: workOrder.id,
        wo_code: workOrder.wo_code,
        picked_items: results.length,
        operator_id: operatorId,
      });
    }
    response.json({
      wo_id: workOrder.id,
      wo_code: workOrder.wo_code,
      picked: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  app.post("/api/work_orders/:id/return", wrap((request, response) => {
    const { wo: workOrder, results, errors } = executeReturn(db, request.params.id, request.body, request.user);
    response.json({
      wo_id: workOrder.id,
      wo_code: workOrder.wo_code,
      returned: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length ? errors : undefined,
    });
  }));

  app.get("/api/work_orders/:id/pick-history", wrap((request, response) => {
    const workOrder = dbGet(db, "SELECT id, wo_code FROM work_orders WHERE id = ?", request.params.id);
    if (!workOrder) throw ApiError.notFound("工单不存在");

    const rows = dbAll(
      db,
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
      workOrder.id,
    );

    const summary = { issue: { count: 0, total_qty: 0 }, return: { count: 0, total_qty: 0 } };
    for (const row of rows) {
      if (row.movement_type === "issue") {
        summary.issue.count += 1;
        summary.issue.total_qty += Number(row.quantity || 0);
      } else if (row.movement_type === "return") {
        summary.return.count += 1;
        summary.return.total_qty += Number(row.quantity || 0);
      }
    }
    summary.issue.total_qty = roundQty(summary.issue.total_qty);
    summary.return.total_qty = roundQty(summary.return.total_qty);

    response.json({
      work_order: workOrder,
      summary,
      movements: rows,
      returnable_lots: getReturnableLots(db, workOrder.id),
      count: rows.length,
    });
  }));
}

module.exports = { registerPickRoutes };
