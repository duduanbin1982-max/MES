"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { createDbAccess, safeBool, toCode, toInteger, toText } = require("./utils");

function normalizePositionPayload(body, { partial = false } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("position_code")) payload.position_code = toCode(source.position_code, "position_code", { required: true, max: 64 });
  if (!partial || has("position_name")) payload.position_name = toText(source.position_name, "position_name", { required: true, max: 100 });
  if (!partial || has("department")) payload.department = toText(source.department, "department", { max: 100 });
  if (!partial || has("skill_category")) payload.skill_category = toText(source.skill_category, "skill_category", { max: 50 }) || "general";
  if (!partial || has("min_level")) payload.min_level = toInteger(source.min_level === undefined ? 1 : source.min_level, "min_level", { min: 1, max: 10 });
  if (!partial || has("required_cert_type")) payload.required_cert_type = toText(source.required_cert_type, "required_cert_type", { max: 50 });
  if (!partial || has("description")) payload.description = toText(source.description, "description", { max: 1000 });
  if (!partial || has("is_active")) payload.is_active = source.is_active === false ? 0 : safeBool(source.is_active === undefined ? 1 : source.is_active);
  return payload;
}

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
    const payload = normalizePositionPayload(request.body || {}, { partial: false });
    const duplicate = get("SELECT id FROM process_positions WHERE position_code = ?", [payload.position_code]);
    if (duplicate) throw ApiError.conflict(`岗位编码已存在：${payload.position_code}（id=${duplicate.id}）`);
    const result = run(`
      INSERT INTO process_positions
        (position_code, position_name, department, skill_category, min_level, required_cert_type, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payload.position_code,
      payload.position_name,
      payload.department,
      payload.skill_category,
      payload.min_level,
      payload.required_cert_type,
      payload.description,
      payload.is_active,
    ]);
    audit.record(db, request, {
      action: "process_master.position.create",
      resource_type: "process_position",
      resource_id: result.lastInsertRowid,
      after: payload,
      diff_summary: `新建岗位 ${payload.position_code}`,
    });
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/positions/:code", wrap((request, response) => {
    const current = get("SELECT * FROM process_positions WHERE position_code = ?", [request.params.code]);
    if (!current) throw ApiError.notFound("岗位不存在");
    const payload = normalizePositionPayload(request.body || {}, { partial: true });
    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(payload)) {
      sets.push(`${field} = ?`);
      params.push(value);
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(current.position_code);
    const result = run(`UPDATE process_positions SET ${sets.join(", ")} WHERE position_code = ?`, params);
    audit.record(db, request, {
      action: "process_master.position.update",
      resource_type: "process_position",
      resource_id: current.position_code,
      before: { position_name: current.position_name, department: current.department, min_level: current.min_level, is_active: current.is_active },
      after: payload,
      diff_summary: `更新岗位 ${current.position_code}`,
    });
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/positions/:code", wrap((request, response) => {
    const current = get("SELECT * FROM process_positions WHERE position_code = ?", [request.params.code]);
    if (!current) throw ApiError.notFound("岗位不存在");
    const used = get(`
      SELECT
        (SELECT COUNT(*) FROM process_operation_templates WHERE required_position_code = ?) +
        (SELECT COUNT(*) FROM process_nodes WHERE required_position_code = ?) AS c
    `, [request.params.code, request.params.code]).c;
    if (used > 0) throw ApiError.conflict(`岗位正在被 ${used} 条工序/节点使用，已改为停用更安全`);
    run("DELETE FROM process_positions WHERE position_code = ?", [request.params.code]);
    audit.record(db, request, {
      action: "process_master.position.delete",
      resource_type: "process_position",
      resource_id: current.position_code,
      before: { position_code: current.position_code, position_name: current.position_name },
      diff_summary: `删除岗位 ${current.position_code}`,
    });
    response.json({ ok: true, deleted: true });
  }));
}

module.exports = { registerPositionRoutes, normalizePositionPayload };
