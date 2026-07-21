"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { STATION_TYPES, jsonText, safeJson, typeLabel } = require("./catalog");

function decorateWorkstation(context, workstation) {
  const assignedWorkers = context.all("SELECT u.id, u.full_name FROM users u WHERE u.workstation_id = ? AND u.availability IN ('busy','online')", workstation.id);
  const activeWorkOrders = context.all("SELECT id, wo_code, title, status FROM work_orders WHERE workstation_id = ? AND status IN ('pending','in_progress','paused') ORDER BY priority, id LIMIT 5", workstation.id);
  const equipment = context.all("SELECT id, code, name, status FROM equipment WHERE workstation_id = ? ORDER BY id", workstation.id);
  const maxWorkers = Number(workstation.max_workers || workstation.capacity_per_day || 1);
  return {
    ...workstation,
    station_type_label: typeLabel(workstation.station_type),
    capability_tags: safeJson(workstation.capability_tags),
    required_skills: safeJson(workstation.required_skills),
    assigned_workers: assignedWorkers,
    assigned_count: assignedWorkers.length,
    active_work_orders: activeWorkOrders,
    active_work_order_count: activeWorkOrders.length,
    equipment,
    equipment_count: equipment.length,
    max_workers: maxWorkers,
    utilization: maxWorkers ? Math.min(100, Math.round((assignedWorkers.length / maxWorkers) * 100)) : 0,
    available_slots: Math.max(0, maxWorkers - assignedWorkers.length),
  };
}

function registerWorkstationRoutes(app, context) {
  const { all, get, run } = context;
  app.get("/api/resources/workstation-types", wrap((_req, res) => res.json(STATION_TYPES)));

  app.get("/api/resources/workstations", wrap((req, res) => {
    const { station_type, status } = req.query;
    let sql = `
      SELECT w.id, w.code, w.name, w.workshop, w.capacity_per_day, w.is_active,
             w.station_type, w.status, w.capability_tags, w.required_skills,
             w.max_workers, w.location, w.shift, w.notes
      FROM workstations w
      WHERE w.is_active = 1
    `;
    const params = [];
    if (station_type) { sql += " AND w.station_type = ?"; params.push(station_type); }
    if (status) { sql += " AND w.status = ?"; params.push(status); }
    sql += " ORDER BY CASE w.station_type WHEN 'assembly' THEN 1 WHEN 'welding' THEN 2 WHEN 'machining' THEN 3 WHEN 'inspection' THEN 4 ELSE 9 END, w.id";
    res.json({ workstations: all(sql, ...params).map((workstation) => decorateWorkstation(context, workstation)) });
  }));

  app.post("/api/resources/workstations", wrap((req, res) => {
    const {
      code, name, workshop, capacity_per_day, is_active, station_type = "general", status = "available",
      capability_tags = [], required_skills = [], max_workers, location, shift = "day", notes,
    } = req.body || {};
    if (!code || !name) throw ApiError.validation("code / name is required");
    if (!STATION_TYPES.some((item) => item.value === station_type)) throw ApiError.validation("station_type is invalid");
    if (get("SELECT id FROM workstations WHERE code = ?", code)) throw ApiError.validation(`workstation code already exists: ${code}`);
    const result = run(`
      INSERT INTO workstations (code, name, workshop, capacity_per_day, is_active, station_type, status, capability_tags, required_skills, max_workers, location, shift, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, code, name, workshop || null, Number(capacity_per_day || 1), is_active == null ? 1 : (is_active ? 1 : 0), station_type, status, jsonText(capability_tags), jsonText(required_skills), Number(max_workers || capacity_per_day || 1), location || null, shift, notes || null);
    res.json({ id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workstations/:id", wrap((req, res) => {
    if (!get("SELECT id FROM workstations WHERE id = ?", req.params.id)) throw ApiError.notFound("Workstation not found");
    const allowed = ["name", "workshop", "capacity_per_day", "is_active", "station_type", "status", "capability_tags", "required_skills", "max_workers", "location", "shift", "notes"];
    const assignments = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        assignments.push(`${key} = ?`);
        params.push(["capability_tags", "required_skills"].includes(key) ? jsonText(req.body[key]) : req.body[key]);
      }
    }
    if (!assignments.length) throw ApiError.validation("no fields to update");
    run(`UPDATE workstations SET ${assignments.join(", ")} WHERE id = ?`, ...params, req.params.id);
    res.json({ ok: true });
  }));
}

module.exports = { decorateWorkstation, registerWorkstationRoutes };
