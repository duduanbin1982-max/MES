"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { applyTemplateToNode, validateAssignment } = require("./assignment");
const { createDbAccess, safeBool } = require("./utils");

function registerOperationRoutes(app, db) {
  const { all, get, run } = createDbAccess(db);

  app.get("/api/process-master/operations", wrap((request, response) => {
    const includeInactive = request.query.include_inactive === "1";
    const rows = all(`
      SELECT t.*, p.position_name,
             (SELECT COUNT(*) FROM process_nodes pn WHERE pn.operation_template_id = t.id) AS node_count
      FROM process_operation_templates t
      LEFT JOIN process_positions p ON p.position_code = t.required_position_code
      ${includeInactive ? "" : "WHERE t.is_active = 1"}
      ORDER BY t.sequence_hint, t.id
    `);
    response.json({ items: rows });
  }));

  app.post("/api/process-master/operations", wrap((request, response) => {
    const body = request.body || {};
    if (!body.operation_code || !body.operation_name) throw ApiError.validation("operation_code / operation_name 必填");
    const result = run(`
      INSERT INTO process_operation_templates
        (operation_code, operation_name, operation_type, category, default_station_type,
         required_skill, required_position_code, standard_hours, worker_count, qc_required,
         sop_required, drawing_required, sequence_hint, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(body.operation_code).trim(),
      String(body.operation_name).trim(),
      body.operation_type || "make",
      body.category || "general",
      body.default_station_type || null,
      body.required_skill || null,
      body.required_position_code || null,
      Number(body.standard_hours || 0),
      Number(body.worker_count || 1),
      safeBool(body.qc_required),
      safeBool(body.sop_required),
      safeBool(body.drawing_required !== false),
      Number(body.sequence_hint || 1),
      body.description || null,
      body.is_active === false ? 0 : 1,
    ]);
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id", wrap((request, response) => {
    const body = request.body || {};
    const current = get("SELECT id FROM process_operation_templates WHERE id = ?", [request.params.id]);
    if (!current) throw ApiError.notFound("工序模板不存在");
    const fields = ["operation_code", "operation_name", "operation_type", "category", "default_station_type", "required_skill", "required_position_code", "standard_hours", "worker_count", "qc_required", "sop_required", "drawing_required", "sequence_hint", "description", "is_active"];
    const booleanFields = new Set(["qc_required", "sop_required", "drawing_required", "is_active"]);
    const sets = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(booleanFields.has(field) ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(request.params.id);
    const result = run(`UPDATE process_operation_templates SET ${sets.join(", ")} WHERE id = ?`, params);
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id", wrap((request, response) => {
    const used = get("SELECT COUNT(*) AS c FROM process_nodes WHERE operation_template_id = ?", [request.params.id]).c;
    if (used > 0) {
      run("UPDATE process_operation_templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [request.params.id]);
      return response.json({ ok: true, disabled: true, reason: `已有 ${used} 个节点引用，已停用模板` });
    }
    run("DELETE FROM process_operation_templates WHERE id = ?", [request.params.id]);
    response.json({ ok: true, deleted: true });
  }));

  app.post("/api/process_nodes/:id/apply-template", wrap((request, response) => {
    const templateId = Number((request.body || {}).operation_template_id);
    if (!templateId) throw ApiError.validation("operation_template_id 必填");
    const result = applyTemplateToNode(db, Number(request.params.id), templateId);
    response.json({ ok: true, ...result });
  }));

  app.post("/api/process-master/validate-assignment", wrap((request, response) => {
    response.json(validateAssignment(db, request.body || {}));
  }));
}

module.exports = { registerOperationRoutes };
