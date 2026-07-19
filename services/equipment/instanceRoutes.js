"use strict";

const { registerLifecycleRoutes } = require("./lifecycleRoutes");

function registerInstanceRoutes({
  app,
  db,
  wrap,
  all,
  get,
  run,
  ApiError,
  lifecycle,
  nextInstanceCode,
  createInstance,
  ensureNotFrozen,
  buildOverview,
}) {
  app.get("/api/equipment_instances/code-preview", wrap((req, res) => {
    res.json({ code: nextInstanceCode(req.query.customer, req.query.year), rule: "TBM-[客户缩写]-YYYY-###" });
  }));

  app.get("/api/equipment_instances/lifecycle-options", wrap((_req, res) => res.json(lifecycle)));

  app.get("/api/equipment_instances", wrap((req, res) => {
    const { status, customer, equipment_type_id: equipmentTypeId } = req.query;
    let sql = "SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE 1=1";
    const params = [];
    if (status) { sql += " AND (ei.status = ? OR ei.lifecycle_stage = ?)"; params.push(status, status); }
    if (customer) { sql += " AND ei.customer_name LIKE ?"; params.push(`%${customer}%`); }
    if (equipmentTypeId) { sql += " AND em.equipment_type_id = ?"; params.push(equipmentTypeId); }
    sql += " ORDER BY ei.created_at DESC";
    res.json(all(sql, params));
  }));

  app.get("/api/equipment_instances/:id", wrap((req, res) => {
    const row = get(
      "SELECT ei.*, em.model_code, em.model_name, em.diameter_mm, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?",
      req.params.id
    );
    if (!row) throw ApiError.notFound("not found");
    res.json(row);
  }));

  app.post("/api/equipment_instances", wrap((req, res) => {
    const result = createInstance(req.body || {}, req.user?.sub || req.user?.id || null);
    res.json({ id: result.id, message: "整机实例已创建", instance_code: result.code, lifecycle_stage: result.lifecycle });
  }));

  app.put("/api/equipment_instances/:id", wrap((req, res) => {
    ensureNotFrozen(req.params.id);
    const fields = [
      "instance_name", "equipment_model_id", "customer_name", "customer_contact", "site_location",
      "contract_no", "contract_amount", "start_date", "planned_start", "planned_end", "actual_start",
      "actual_end", "status", "lifecycle_stage", "progress_pct", "serial_no", "project_no", "notes",
    ];
    const updates = [];
    const values = [];
    for (const field of fields) {
      if (req.body[field] !== undefined) { updates.push(`${field} = ?`); values.push(req.body[field]); }
    }
    if (!updates.length) throw ApiError.validation("no fields");
    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);
    const result = run(`UPDATE equipment_instances SET ${updates.join(", ")} WHERE id = ?`, values);
    res.json({ changes: result.changes });
  }));

  app.delete("/api/equipment_instances/:id", wrap((req, res) => {
    ensureNotFrozen(req.params.id);
    res.json({ changes: run("DELETE FROM equipment_instances WHERE id = ?", req.params.id).changes });
  }));

  app.get("/api/equipment_instances/:id/dashboard", wrap((req, res) => {
    const instance = get(
      "SELECT ei.*, em.model_code, em.model_name, et.name_zh as type_name FROM equipment_instances ei LEFT JOIN equipment_models em ON ei.equipment_model_id = em.id LEFT JOIN equipment_types et ON em.equipment_type_id = et.id WHERE ei.id = ?",
      req.params.id
    );
    if (!instance) throw ApiError.notFound("not found");
    const workOrders = get("SELECT count(*) as total, sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, sum(CASE WHEN status = 'issue' THEN 1 ELSE 0 END) as issue FROM work_orders WHERE equipment_instance_id = ?", req.params.id);
    const processNodes = get("SELECT count(*) as total, sum(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready, sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress, sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM process_nodes WHERE equipment_instance_id = ?", req.params.id);
    const milestones = all("SELECT * FROM equipment_instance_milestones WHERE project_id = ? ORDER BY sequence, id", req.params.id);
    const bomCount = get("SELECT count(*) AS count FROM instance_bom WHERE equipment_instance_id = ?", req.params.id).count;
    res.json({ instance, work_orders: workOrders, process_nodes: processNodes, milestones, bom_count: bomCount });
  }));

  app.get("/api/equipment_instances/:id/overview", wrap((req, res) => res.json(buildOverview(req.params.id))));
  registerLifecycleRoutes({ app, db, wrap, ApiError, ensureNotFrozen, buildOverview });
}

module.exports = { registerInstanceRoutes };
