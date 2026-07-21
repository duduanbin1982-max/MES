"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerAllocationRoutes(app, context) {
  const { all, get, run } = context;

  app.post("/api/resources/allocations", wrap((req, res) => {
    const { user_id, workstation_id, equipment_instance_id, work_order_id, notes } = req.body || {};
    if (!user_id) throw ApiError.validation("user_id is required");
    if (!get("SELECT id FROM users WHERE id = ? AND is_active = 1", user_id)) throw ApiError.notFound("User not found or inactive");
    if (workstation_id && !get("SELECT id FROM workstations WHERE id = ? AND is_active = 1", workstation_id)) throw ApiError.notFound("Workstation not found or inactive");
    if (equipment_instance_id && !get("SELECT id FROM equipment_instances WHERE id = ?", equipment_instance_id)) throw ApiError.notFound("Equipment instance not found");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", user_id);
    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, notes, status) VALUES (?, ?, ?, ?, ?, 'active')",
      user_id, workstation_id || null, equipment_instance_id || null, work_order_id || null, notes || null
    );
    const assignments = ["availability = ?"];
    const params = ["busy"];
    if (workstation_id) { assignments.push("workstation_id = ?"); params.push(workstation_id); }
    run(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`, ...params, user_id);
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
