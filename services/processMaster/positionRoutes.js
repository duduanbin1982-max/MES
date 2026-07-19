"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { createDbAccess, safeBool } = require("./utils");

function registerPositionRoutes(app, db) {
  const { all, get, run } = createDbAccess(db);

  app.get("/api/process-master/positions", wrap((request, response) => {
    const includeInactive = request.query.include_inactive === "1";
    const rows = all(`
      SELECT p.*,
             (SELECT COUNT(*) FROM process_operation_templates t WHERE t.required_position_code = p.position_code) AS template_count,
             (SELECT COUNT(*) FROM process_nodes n WHERE n.required_position_code = p.position_code) AS node_count
      FROM process_positions p
      ${includeInactive ? "" : "WHERE p.is_active = 1"}
      ORDER BY p.department, p.id
    `);
    response.json({ items: rows });
  }));

  app.post("/api/process-master/positions", wrap((request, response) => {
    const body = request.body || {};
    if (!body.position_code || !body.position_name) throw ApiError.validation("position_code / position_name 必填");
    const result = run(`
      INSERT INTO process_positions
        (position_code, position_name, department, skill_category, min_level, required_cert_type, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      String(body.position_code).trim(),
      String(body.position_name).trim(),
      body.department || null,
      body.skill_category || "general",
      Number(body.min_level || 1),
      body.required_cert_type || null,
      body.description || null,
      body.is_active === false ? 0 : 1,
    ]);
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/positions/:code", wrap((request, response) => {
    const body = request.body || {};
    const current = get("SELECT id FROM process_positions WHERE position_code = ?", [request.params.code]);
    if (!current) throw ApiError.notFound("岗位不存在");
    const fields = ["position_name", "department", "skill_category", "min_level", "required_cert_type", "description", "is_active"];
    const sets = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(field === "is_active" ? safeBool(body[field]) : body[field]);
      }
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(request.params.code);
    const result = run(`UPDATE process_positions SET ${sets.join(", ")} WHERE position_code = ?`, params);
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/positions/:code", wrap((request, response) => {
    const used = get(`
      SELECT
        (SELECT COUNT(*) FROM process_operation_templates WHERE required_position_code = ?) +
        (SELECT COUNT(*) FROM process_nodes WHERE required_position_code = ?) AS c
    `, [request.params.code, request.params.code]).c;
    if (used > 0) throw ApiError.conflict(`岗位正在被 ${used} 条工序/节点使用，已改为停用更安全`);
    run("DELETE FROM process_positions WHERE position_code = ?", [request.params.code]);
    response.json({ ok: true, deleted: true });
  }));
}

module.exports = { registerPositionRoutes };
