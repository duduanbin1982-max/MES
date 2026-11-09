"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { typeLabel } = require("./catalog");

function registerSummaryRoutes(app, context) {
  const { all, get } = context;

  app.get("/api/resources/equipment", wrap((req, res) => {
    const hasTable = (name) => !!get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", name);
    const hasDelivery = hasTable("delivery_orders");
    const hasAcceptance = hasTable("acceptance_records");
    const keyword = String(req.query.keyword || "").trim();
    const stage = String(req.query.stage || "").trim();
    const includeArchived = String(req.query.include_archived || "true") !== "false";
    const where = ["1=1"];
    const params = [];
    if (!includeArchived) where.push("COALESCE(ei.archive_status, 'active') != 'archived'");
    if (keyword) {
      where.push("(ei.instance_code LIKE ? OR ei.instance_name LIKE ? OR COALESCE(ei.customer_name,'') LIKE ? OR COALESCE(ei.serial_no,'') LIKE ? OR COALESCE(ei.project_no,'') LIKE ? OR COALESCE(ei.contract_no,'') LIKE ?)");
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like, like);
    }
    if (stage) {
      where.push("(CASE WHEN ei.lifecycle_stage = 'S1' THEN 'design' ELSE COALESCE(NULLIF(ei.lifecycle_stage,''), ei.status) END) = ?");
      params.push(stage);
    }
    const equipment = all(`
      SELECT ei.*,
             em.model_code, em.model_name, et.name_zh AS type_name,
             CASE WHEN ei.lifecycle_stage = 'S1' THEN 'design'
                  ELSE COALESCE(NULLIF(ei.lifecycle_stage,''), ei.status) END AS lifecycle_stage_normalized,
             CASE WHEN ei.archive_status = 'archived' OR ei.status IN ('delivered','operation','completed','archived')
                    OR (CASE WHEN ei.lifecycle_stage = 'S1' THEN 'design' ELSE COALESCE(NULLIF(ei.lifecycle_stage,''), ei.status) END) IN ('delivered','operation','completed','archived')
                  THEN 1 ELSE 0 END AS is_terminal,
             CASE WHEN ei.planned_end IS NOT NULL AND ei.planned_end < date('now')
                    AND COALESCE(ei.archive_status,'active') != 'archived'
                    AND (CASE WHEN ei.lifecycle_stage = 'S1' THEN 'design' ELSE COALESCE(NULLIF(ei.lifecycle_stage,''), ei.status) END) NOT IN ('delivered','operation','completed','archived')
                  THEN 1 ELSE 0 END AS is_overdue
             ${hasDelivery ? ", (SELECT d.status FROM delivery_orders d WHERE d.equipment_instance_id = ei.id ORDER BY COALESCE(d.planned_date, d.created_at) DESC, d.id DESC LIMIT 1) AS delivery_status" : ", NULL AS delivery_status"}
             ${hasAcceptance ? ", (SELECT a.result FROM acceptance_records a WHERE a.equipment_instance_id = ei.id ORDER BY COALESCE(a.planned_date, a.created_at) DESC, a.id DESC LIMIT 1) AS acceptance_result" : ", NULL AS acceptance_result"}
      FROM equipment_instances ei
      LEFT JOIN equipment_models em ON em.id = ei.equipment_model_id
      LEFT JOIN equipment_types et ON et.id = em.equipment_type_id
      WHERE ${where.join(" AND ")}
      ORDER BY ei.id
    `, ...params);
    const summary = {
      total: equipment.length,
      active: equipment.filter((item) => String(item.archive_status || "active") !== "archived").length,
      in_progress: equipment.filter((item) => !Number(item.is_terminal)).length,
      completed: equipment.filter((item) => Number(item.is_terminal)).length,
      archived: equipment.filter((item) => String(item.archive_status) === "archived").length,
      delayed: equipment.filter((item) => Number(item.is_overdue) || item.status === "delayed" || item.lifecycle_stage === "delayed").length,
    };
    res.json({ equipment, summary, filters: { keyword, stage, include_archived: includeArchived } });
  }));

  app.get("/api/resources/overview", wrap((_req, res) => {
    const workers = get(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN availability IN ('idle','online') THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN availability = 'busy' THEN 1 ELSE 0 END) AS busy,
        SUM(CASE WHEN availability = 'offline' OR availability IS NULL THEN 1 ELSE 0 END) AS offline,
        SUM(CASE WHEN availability = 'leave' THEN 1 ELSE 0 END) AS leave
      FROM users WHERE is_active = 1
    `);
    const equipment = get(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status IN ('design','procurement','manufacturing','assembly','commissioning','acceptance') THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance,
        SUM(CASE WHEN status IN ('idle','delivered','operation') THEN 1 ELSE 0 END) AS idle
      FROM equipment_instances
    `);
    const workstations = get(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status IN ('maintenance','blocked') THEN 1 ELSE 0 END) AS blocked
      FROM workstations WHERE is_active = 1
    `);
    const occupied = get("SELECT COUNT(DISTINCT workstation_id) AS cnt FROM users WHERE workstation_id IS NOT NULL AND availability IN ('busy','online')")?.cnt || 0;
    const byType = all("SELECT station_type, COUNT(*) total, SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) available FROM workstations WHERE is_active = 1 GROUP BY station_type")
      .map((row) => ({ ...row, label: typeLabel(row.station_type) }));
    const alerts = [];
    if ((workers.offline || 0) > 0) alerts.push({ type: "warning", message: `${workers.offline} 人离线` });
    if ((workstations.blocked || 0) > 0) alerts.push({ type: "danger", message: `${workstations.blocked} 个工位维护/阻塞` });
    for (const required of ["assembly", "welding", "machining", "inspection"]) {
      if (!byType.some((row) => row.station_type === required && row.total > 0)) alerts.push({ type: "danger", message: `缺少${typeLabel(required)}` });
    }
    res.json({
      workers: { total: workers.total || 0, available: workers.available || 0, busy: workers.busy || 0, offline: workers.offline || 0, leave: workers.leave || 0 },
      equipment: { total: equipment.total || 0, running: equipment.running || 0, maintenance: equipment.maintenance || 0, idle: equipment.idle || 0 },
      workstations: {
        total: workstations.total || 0,
        occupied,
        free: Math.max(0, (workstations.total || 0) - occupied),
        available: workstations.available || 0,
        blocked: workstations.blocked || 0,
        by_type: byType,
      },
      alerts,
    });
  }));
}

module.exports = { registerSummaryRoutes };
