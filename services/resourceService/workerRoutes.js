"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { safeJson } = require("./catalog");
const { getWorkstation, assertCapacity, assertAvailability, assertOptionalReference } = require("./helpers");
const audit = require("../../app/audit");

function registerWorkerRoutes(app, context) {
  const { all, get, run, db } = context;

  app.get("/api/resources/workers", wrap((_req, res) => {
    const workers = all(`
      SELECT u.id, u.full_name, u.role_code, u.availability,
             u.skills, u.cert_type, u.is_active, u.workstation_id,
             w.name AS workstation_name, w.workshop, w.station_type
      FROM users u
      LEFT JOIN workstations w ON u.workstation_id = w.id
      ORDER BY u.id
    `).map((worker) => ({ ...worker, skills: safeJson(worker.skills) }));
    res.json({
      workers,
      summary: {
        total: workers.length,
        available: workers.filter((worker) => ["idle", "online"].includes(worker.availability)).length,
        busy: workers.filter((worker) => worker.availability === "busy").length,
        offline: workers.filter((worker) => !worker.availability || worker.availability === "offline").length,
        leave: workers.filter((worker) => worker.availability === "leave").length,
      },
    });
  }));

  app.put("/api/resources/workers/:id/station", wrap((req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const { workstation_id, equipment_instance_id, work_order_id, notes, availability } = req.body || {};
    if (!Number.isInteger(userId) || userId <= 0) throw ApiError.validation("worker id 非法");
    if (!workstation_id) throw ApiError.validation("workstation_id is required");
    const worker = get("SELECT id, availability, workstation_id FROM users WHERE id = ? AND is_active = 1", userId);
    if (!worker) throw ApiError.notFound("Worker not found");
    const workstation = getWorkstation(context, workstation_id);
    assertCapacity(context, workstation, userId);
    const nextAvailability = assertAvailability(availability, "busy");
    const instanceId = assertOptionalReference(context, "equipment_instances", equipment_instance_id, "equipment_instance_id");
    const workOrderId = assertOptionalReference(context, "work_orders", work_order_id, "work_order_id");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = ?, availability = ? WHERE id = ?", workstation.id, nextAvailability, userId);
    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
      userId, workstation.id, instanceId, workOrderId, "active", notes || null
    );
    audit.record(db, req, {
      action: "resource.worker.assign",
      resource_type: "user",
      resource_id: userId,
      before: { workstation_id: worker.workstation_id, availability: worker.availability },
      after: { workstation_id: workstation.id, availability: nextAvailability, allocation_id: result.lastInsertRowid },
      diff_summary: `人员 ${userId} 分配至工位 ${workstation.code}`,
    });
    res.json({ ok: true, user_id: userId, workstation_id: workstation.id, availability: nextAvailability, allocation_id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workers/:id/release", wrap((req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const worker = get("SELECT id, workstation_id, availability FROM users WHERE id = ?", userId);
    if (!worker) throw ApiError.notFound("Worker not found");
    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = NULL, availability = ? WHERE id = ?", "idle", userId);
    audit.record(db, req, {
      action: "resource.worker.release",
      resource_type: "user",
      resource_id: userId,
      before: { workstation_id: worker.workstation_id, availability: worker.availability },
      after: { workstation_id: null, availability: "idle" },
      diff_summary: `释放人员 ${userId}`,
    });
    res.json({ ok: true, user_id: userId });
  }));

  app.put("/api/resources/workers/:id/availability", wrap((req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const { availability } = req.body || {};
    const valid = ["idle", "online", "busy", "offline", "leave"];
    if (!availability || !valid.includes(availability)) throw ApiError.validation(`availability must be one of: ${valid.join(", ")}`);
    const worker = get("SELECT id, workstation_id, availability FROM users WHERE id = ?", userId);
    if (!worker) throw ApiError.notFound("Worker not found");
    run("UPDATE users SET availability = ? WHERE id = ?", availability, userId);
    if (!["busy", "online"].includes(availability)) {
      run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
      if (availability !== "idle") run("UPDATE users SET workstation_id = NULL WHERE id = ?", userId);
    }
    audit.record(db, req, {
      action: "resource.worker.availability",
      resource_type: "user",
      resource_id: userId,
      before: { availability: worker.availability },
      after: { availability },
      diff_summary: `更新人员 ${userId} 状态为 ${availability}`,
    });
    res.json({ ok: true, user_id: userId, availability });
  }));
}

module.exports = { registerWorkerRoutes };
