"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { STATION_TYPES, safeJson, typeLabel } = require("./catalog");
const { validateWorkstationPayload, assignedCount } = require("./helpers");
const audit = require("../../app/audit");

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
  const { all, get, run, db } = context;
  app.get("/api/resources/workstation-types", wrap((_req, res) => res.json(STATION_TYPES)));

  app.get("/api/resources/workstations", wrap((req, res) => {
    const { station_type, status } = req.query;
    const includeInactive = req.query.include_inactive === "1";
    let sql = `
      SELECT w.id, w.code, w.name, w.workshop, w.capacity_per_day, w.is_active,
             w.station_type, w.status, w.capability_tags, w.required_skills,
             w.max_workers, w.location, w.shift, w.notes
      FROM workstations w
      WHERE 1=1
    `;
    const params = [];
    if (!includeInactive) sql += " AND w.is_active = 1";
    if (station_type) { sql += " AND w.station_type = ?"; params.push(station_type); }
    if (status) { sql += " AND w.status = ?"; params.push(status); }
    sql += " ORDER BY CASE w.station_type WHEN 'assembly' THEN 1 WHEN 'welding' THEN 2 WHEN 'machining' THEN 3 WHEN 'inspection' THEN 4 ELSE 9 END, w.id";
    res.json({ workstations: all(sql, ...params).map((workstation) => decorateWorkstation(context, workstation)) });
  }));

  app.post("/api/resources/workstations", wrap((req, res) => {
    const payload = validateWorkstationPayload(req.body || {});
    if (get("SELECT id FROM workstations WHERE LOWER(code) = LOWER(?)", payload.code)) throw ApiError.validation(`工位编码已存在: ${payload.code}`);
    const result = run(`
      INSERT INTO workstations (code, name, workshop, capacity_per_day, is_active, station_type, status, capability_tags, required_skills, max_workers, location, shift, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, payload.code, payload.name, payload.workshop, payload.capacity_per_day, payload.is_active, payload.station_type, payload.status,
      payload.capability_tags, payload.required_skills, payload.max_workers, payload.location, payload.shift, payload.notes);
    audit.record(db, req, {
      action: "resource.workstation.create",
      resource_type: "workstation",
      resource_id: result.lastInsertRowid,
      after: payload,
      diff_summary: `新建工位 ${payload.code} ${payload.name}`,
    });
    res.status(201).json({ id: result.lastInsertRowid });
  }));

  app.put("/api/resources/workstations/:id", wrap((req, res) => {
    const current = get("SELECT * FROM workstations WHERE id = ?", req.params.id);
    if (!current) throw ApiError.notFound("Workstation not found");
    const payload = validateWorkstationPayload(req.body || {}, { partial: true });
    const entries = Object.entries(payload);
    if (!entries.length) throw ApiError.validation("no fields to update");
    const disabling = payload.is_active === 0 || payload.status === "disabled";
    if (disabling) {
      const used = assignedCount(context, current.id);
      if (used > 0) throw ApiError.validation(`工位仍有 ${used} 名人员，不能停用；请先释放人员`);
    }
    run(`UPDATE workstations SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, value]) => value), current.id);
    audit.record(db, req, {
      action: "resource.workstation.update",
      resource_type: "workstation",
      resource_id: current.id,
      before: { name: current.name, status: current.status, max_workers: current.max_workers, is_active: current.is_active },
      after: payload,
      diff_summary: `更新工位 ${current.code}`,
    });
    res.json({ ok: true });
  }));
}

module.exports = { decorateWorkstation, registerWorkstationRoutes };
