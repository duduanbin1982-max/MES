"use strict";

function registerCatalogRoutes({ app, wrap, all, get, ApiError }) {
  app.get("/api/equipment_types", wrap((_req, res) => {
    res.json(all("SELECT * FROM equipment_types WHERE is_active = 1 ORDER BY id"));
  }));
  app.get("/api/equipment_types/:id", wrap((req, res) => {
    const equipmentType = get("SELECT * FROM equipment_types WHERE id = ?", req.params.id);
    if (!equipmentType) throw ApiError.notFound("not found");
    res.json(equipmentType);
  }));
  app.get("/api/equipment_models", wrap((req, res) => {
    let sql = "SELECT em.*, et.name_zh as type_name FROM equipment_models em LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
    const params = [];
    if (req.query.equipment_type_id) { sql += " AND em.equipment_type_id = ?"; params.push(req.query.equipment_type_id); }
    res.json(all(`${sql} ORDER BY em.id`, params));
  }));
  app.get("/api/equipment_subsystems", wrap((req, res) => {
    let sql = "SELECT * FROM equipment_subsystems WHERE 1=1";
    const params = [];
    if (req.query.equipment_type_id) { sql += " AND equipment_type_id = ?"; params.push(req.query.equipment_type_id); }
    res.json(all(`${sql} ORDER BY sequence`, params));
  }));
  app.get("/api/workstations", wrap((_req, res) => res.json(all("SELECT * FROM workstations ORDER BY id"))));
  app.get("/api/equipment", wrap((_req, res) => res.json(all("SELECT * FROM equipment ORDER BY id"))));
  app.get("/api/equipment/live_status", wrap((_req, res) => {
    const equipmentTotal = get("SELECT COUNT(*) AS count FROM equipment") || { count: 0 };
    const equipmentIdle = get("SELECT COUNT(*) AS count FROM equipment WHERE id NOT IN (SELECT workstation_id FROM work_orders WHERE status='in_progress' AND workstation_id IS NOT NULL)") || { count: 0 };
    const workOrdersInProgress = get("SELECT COUNT(*) AS count FROM work_orders WHERE status='in_progress'") || { count: 0 };
    const processNodesInProgress = get("SELECT COUNT(*) AS count FROM process_nodes WHERE status='in_progress'") || { count: 0 };
    const bySubsystem = all("SELECT es.name_zh as subsystem, COUNT(DISTINCT pn.id) as in_progress_nodes FROM equipment_subsystems es LEFT JOIN process_nodes pn ON pn.equipment_instance_id IN (SELECT id FROM equipment_instances) WHERE pn.status='in_progress' GROUP BY es.id ORDER BY in_progress_nodes DESC");
    const recentStarts = all("SELECT wo.*, ei.instance_code, ei.instance_name FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.status='in_progress' ORDER BY wo.actual_start DESC LIMIT 10");
    const busy = equipmentTotal.count - equipmentIdle.count;
    const utilization = equipmentTotal.count ? Math.round(busy * 100 / equipmentTotal.count) : 0;
    res.json({
      equipment_total: equipmentTotal.count,
      equipment_busy: busy,
      equipment_idle: equipmentIdle.count,
      utilization,
      wo_in_progress: workOrdersInProgress.count,
      pn_in_progress: processNodesInProgress.count,
      by_subsystem: bySubsystem,
      recent_starts: recentStarts,
    });
  }));
}

module.exports = { registerCatalogRoutes };
