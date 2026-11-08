"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { getWorkstation, assertCapacity, assertOptionalReference } = require("./helpers");
const audit = require("../../app/audit");

function registerAllocationRoutes(app, context) {
  const { all, get, run, db } = context;

  app.post("/api/resources/allocations", wrap((req, res) => {
    const { user_id, workstation_id, equipment_instance_id, work_order_id, notes } = req.body || {};
    const userId = Number(user_id);
    if (!Number.isInteger(userId) || userId <= 0) throw ApiError.validation("user_id is required");
    const worker = get("SELECT id, workstation_id, availability FROM users WHERE id = ? AND is_active = 1", userId);
    if (!worker) throw ApiError.notFound("User not found or inactive");
    const instanceId = assertOptionalReference(context, "equipment_instances", equipment_instance_id, "equipment_instance_id");
    const orderId = assertOptionalReference(context, "work_orders", work_order_id, "work_order_id");
    let station = null;
    if (workstation_id) {
      station = getWorkstation(context, workstation_id);
      assertCapacity(context, station, userId);
    }

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, notes, status) VALUES (?, ?, ?, ?, ?, 'active')",
      userId, station ? station.id : null, instanceId, orderId, notes || null
    );
    run("UPDATE users SET availability = 'busy', workstation_id = ? WHERE id = ?", station ? station.id : null, userId);
    audit.record(db, req, {
      action: "resource.allocation.create",
      resource_type: "resource_allocation",
      resource_id: result.lastInsertRowid,
      after: { user_id: userId, workstation_id: station ? station.id : null, equipment_instance_id: instanceId, work_order_id: orderId },
      diff_summary: `资源分配 user=${userId} station=${station ? station.id : "-"}`,
    });
    res.json({ ok: true, allocation_id: result.lastInsertRowid });
  }));

  app.get("/api/resources/allocations", wrap((req, res) => {
    let sql = `
      SELECT ra.*, u.full_name AS user_name,
             w.name AS workstation_name, w.station_type,
             ei.instance_name AS equipment_name,
             wo.wo_code, wo.title AS work_order_title
      FROM resource_allocations ra
      LEFT JOIN users u ON ra.user_id = u.id
      LEFT JOIN workstations w ON ra.workstation_id = w.id
      LEFT JOIN equipment_instances ei ON ra.equipment_instance_id = ei.id
      LEFT JOIN work_orders wo ON ra.work_order_id = wo.id
    `;
    const params = [];
    if (req.query.status) { sql += " WHERE ra.status = ?"; params.push(req.query.status); }
    sql += " ORDER BY ra.assigned_at DESC";
    res.json({ allocations: all(sql, ...params) });
  }));
}

module.exports = { registerAllocationRoutes };
