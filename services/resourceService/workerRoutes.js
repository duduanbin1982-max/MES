"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { safeJson } = require("./catalog");

function registerWorkerRoutes(app, context) {
  const { all, get, run } = context;

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
    const { workstation_id, equipment_instance_id, work_order_id, notes } = req.body || {};
    if (!workstation_id) throw ApiError.validation("workstation_id is required");
    if (!get("SELECT id, availability FROM users WHERE id = ? AND is_active = 1", userId)) throw ApiError.notFound("Worker not found");
    const workstation = get("SELECT id, max_workers, capacity_per_day FROM workstations WHERE id = ? AND is_active = 1 AND status != 'disabled'", workstation_id);
    if (!workstation) throw ApiError.notFound("Workstation not found or inactive");
    const busyCount = get("SELECT COUNT(*) c FROM users WHERE workstation_id = ? AND availability = 'busy'", workstation_id).c || 0;
    if (busyCount >= Number(workstation.max_workers || workstation.capacity_per_day || 1)) throw ApiError.validation("工位人员容量已满");

    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = ?, availability = ? WHERE id = ?", workstation_id, "busy", userId);
    const result = run(
      "INSERT INTO resource_allocations (user_id, workstation_id, equipment_instance_id, work_order_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)",
      userId, workstation_id, equipment_instance_id || null, work_order_id || null, "active", notes || null
    );
    res.json({ ok: true, user_id: userId, workstation_id, allocation_id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workers/:id/release", wrap((req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    if (!get("SELECT id FROM users WHERE id = ?", userId)) throw ApiError.notFound("Worker not found");
    run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE users SET workstation_id = NULL, availability = ? WHERE id = ?", "idle", userId);
    res.json({ ok: true, user_id: userId });
  }));

  app.put("/api/resources/workers/:id/availability", wrap((req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const { availability } = req.body || {};
    const valid = ["idle", "online", "busy", "offline", "leave"];
    if (!availability || !valid.includes(availability)) throw ApiError.validation(`availability must be one of: ${valid.join(", ")}`);
    if (!get("SELECT id FROM users WHERE id = ?", userId)) throw ApiError.notFound("Worker not found");
    run("UPDATE users SET availability = ? WHERE id = ?", availability, userId);
    if (!["busy", "online"].includes(availability)) {
      run("UPDATE resource_allocations SET released_at = datetime('now'), status = 'released' WHERE user_id = ? AND status = 'active'", userId);
      if (availability !== "idle") run("UPDATE users SET workstation_id = NULL WHERE id = ?", userId);
    }
    res.json({ ok: true, user_id: userId, availability });
  }));
}

module.exports = { registerWorkerRoutes };
