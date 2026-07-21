"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { typeLabel } = require("./catalog");

function registerSummaryRoutes(app, context) {
  const { all, get } = context;

  app.get("/api/resources/equipment", wrap((_req, res) => {
    const equipment = all(`
      SELECT ei.id, ei.instance_code, ei.instance_name, ei.status,
             ei.lifecycle_stage, ei.progress_pct, ei.customer_name
      FROM equipment_instances ei
      ORDER BY ei.id
    `);
    res.json({
      equipment,
      summary: {
        total: equipment.length,
        in_progress: equipment.filter((item) => !["delivered", "operation", "archived", "completed"].includes(item.status)).length,
        completed: equipment.filter((item) => ["delivered", "operation", "completed"].includes(item.status)).length,
        delayed: equipment.filter((item) => item.status === "delayed").length,
      },
    });
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
    const occupied = get("SELECT COUNT(DISTINCT workstation_id) AS cnt FROM users WHERE workstation_id IS NOT NULL AND availability = 'busy'")?.cnt || 0;
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
