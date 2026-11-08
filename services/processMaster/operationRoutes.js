"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const audit = require("../../app/audit");
const { applyTemplateToNode, validateAssignment } = require("./assignment");
const { createDbAccess, safeBool, toCode, toInteger, toNumber, toText } = require("./utils");

const OPERATION_TYPES = new Set(["make", "buy", "assemble", "assembly", "qc", "test"]);

function assertPosition(db, code) {
  if (code === undefined || code === null || code === "") return null;
  const value = String(code).trim();
  if (!value) return null;
  const row = db.prepare("SELECT position_code, is_active FROM process_positions WHERE position_code = ?").get(value);
  if (!row) throw ApiError.validation(`岗位不存在：${value}`);
  if (!row.is_active) throw ApiError.validation(`岗位已停用：${value}`);
  return value;
}

function normalizeOperationPayload(db, body, { partial = false } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("operation_code")) payload.operation_code = toCode(source.operation_code, "operation_code", { required: true, max: 64 });
  if (!partial || has("operation_name")) payload.operation_name = toText(source.operation_name, "operation_name", { required: true, max: 100 });
  if (!partial || has("operation_type")) {
    const type = toText(source.operation_type, "operation_type", { max: 30 }) || "make";
    if (!OPERATION_TYPES.has(type)) throw ApiError.validation(`operation_type 必须是 ${[...OPERATION_TYPES].join(" / ")}`);
    payload.operation_type = type;
  }
  if (!partial || has("category")) payload.category = toText(source.category, "category", { max: 50 }) || "general";
  if (!partial || has("default_station_type")) payload.default_station_type = toText(source.default_station_type, "default_station_type", { max: 50 });
  if (!partial || has("required_skill")) payload.required_skill = toText(source.required_skill, "required_skill", { max: 100 });
  if (!partial || has("required_position_code")) payload.required_position_code = assertPosition(db, source.required_position_code);
  if (!partial || has("standard_hours")) payload.standard_hours = toNumber(source.standard_hours === undefined ? 0 : source.standard_hours, "standard_hours", { min: 0, max: 100000 });
  if (!partial || has("worker_count")) payload.worker_count = toInteger(source.worker_count === undefined ? 1 : source.worker_count, "worker_count", { min: 1, max: 1000 });
  if (!partial || has("sequence_hint")) payload.sequence_hint = toInteger(source.sequence_hint === undefined ? 1 : source.sequence_hint, "sequence_hint", { min: 0, max: 1000000 });
  if (!partial || has("description")) payload.description = toText(source.description, "description", { max: 2000 });
  if (!partial || has("qc_required")) payload.qc_required = safeBool(source.qc_required);
  if (!partial || has("sop_required")) payload.sop_required = safeBool(source.sop_required);
  if (!partial || has("drawing_required")) payload.drawing_required = safeBool(source.drawing_required === undefined ? true : source.drawing_required);
  if (!partial || has("is_active")) payload.is_active = source.is_active === false ? 0 : safeBool(source.is_active === undefined ? 1 : source.is_active);
  return payload;
}

function registerOperationRoutes(app, db) {
  const { all, get, run } = createDbAccess(db);

  app.get("/api/process-master/operations", wrap((request, response) => {
    const includeInactive = request.query.include_inactive === "1";
    const rows = all(`
      SELECT t.*, p.position_name,
             (SELECT COUNT(*) FROM process_nodes pn WHERE pn.operation_template_id = t.id) AS node_count,
             (SELECT COUNT(*) FROM process_operation_docs d WHERE d.operation_template_id = t.id) AS doc_count,
             (SELECT COUNT(*) FROM process_operation_docs d WHERE d.operation_template_id = t.id AND d.is_required = 1) AS required_doc_count
      FROM process_operation_templates t
      LEFT JOIN process_positions p ON p.position_code = t.required_position_code
      ${includeInactive ? "" : "WHERE t.is_active = 1"}
      ORDER BY t.sequence_hint, t.id
    `);
    response.json({ items: rows });
  }));

  app.post("/api/process-master/operations", wrap((request, response) => {
    const payload = normalizeOperationPayload(db, request.body || {}, { partial: false });
    const duplicate = get("SELECT id FROM process_operation_templates WHERE operation_code = ?", [payload.operation_code]);
    if (duplicate) throw ApiError.conflict(`工序编码已存在：${payload.operation_code}（id=${duplicate.id}）`);
    const result = run(`
      INSERT INTO process_operation_templates
        (operation_code, operation_name, operation_type, category, default_station_type,
         required_skill, required_position_code, standard_hours, worker_count, qc_required,
         sop_required, drawing_required, sequence_hint, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payload.operation_code,
      payload.operation_name,
      payload.operation_type,
      payload.category,
      payload.default_station_type,
      payload.required_skill,
      payload.required_position_code,
      payload.standard_hours,
      payload.worker_count,
      payload.qc_required,
      payload.sop_required,
      payload.drawing_required,
      payload.sequence_hint,
      payload.description,
      payload.is_active,
    ]);
    audit.record(db, request, {
      action: "process_master.operation.create",
      resource_type: "process_operation_template",
      resource_id: result.lastInsertRowid,
      after: payload,
      diff_summary: `新建工序模板 ${payload.operation_code}`,
    });
    response.status(201).json({ id: result.lastInsertRowid, created: true });
  }));

  app.put("/api/process-master/operations/:id", wrap((request, response) => {
    const current = get("SELECT * FROM process_operation_templates WHERE id = ?", [request.params.id]);
    if (!current) throw ApiError.notFound("工序模板不存在");
    const payload = normalizeOperationPayload(db, request.body || {}, { partial: true });
    if (payload.operation_code && payload.operation_code !== current.operation_code) {
      const duplicate = get("SELECT id FROM process_operation_templates WHERE operation_code = ? AND id <> ?", [payload.operation_code, current.id]);
      if (duplicate) throw ApiError.conflict(`工序编码已存在：${payload.operation_code}（id=${duplicate.id}）`);
    }
    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(payload)) {
      sets.push(`${field} = ?`);
      params.push(value);
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(current.id);
    const result = run(`UPDATE process_operation_templates SET ${sets.join(", ")} WHERE id = ?`, params);
    audit.record(db, request, {
      action: "process_master.operation.update",
      resource_type: "process_operation_template",
      resource_id: current.id,
      before: { operation_code: current.operation_code, operation_name: current.operation_name, standard_hours: current.standard_hours, worker_count: current.worker_count, is_active: current.is_active },
      after: payload,
      diff_summary: `更新工序模板 ${current.operation_code}`,
    });
    response.json({ ok: true, changes: result.changes });
  }));

  app.delete("/api/process-master/operations/:id", wrap((request, response) => {
    const current = get("SELECT * FROM process_operation_templates WHERE id = ?", [request.params.id]);
    if (!current) throw ApiError.notFound("工序模板不存在");
    const used = get("SELECT COUNT(*) AS c FROM process_nodes WHERE operation_template_id = ?", [request.params.id]).c;
    if (used > 0) {
      run("UPDATE process_operation_templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [request.params.id]);
      audit.record(db, request, {
        action: "process_master.operation.disable",
        resource_type: "process_operation_template",
        resource_id: current.id,
        before: { is_active: current.is_active },
        after: { is_active: 0 },
        diff_summary: `工序模板 ${current.operation_code} 被 ${used} 个节点引用，改为停用`,
      });
      return response.json({ ok: true, disabled: true, reason: `已有 ${used} 个节点引用，已停用模板` });
    }
    run("DELETE FROM process_operation_templates WHERE id = ?", [request.params.id]);
    audit.record(db, request, {
      action: "process_master.operation.delete",
      resource_type: "process_operation_template",
      resource_id: current.id,
      before: { operation_code: current.operation_code, operation_name: current.operation_name },
      diff_summary: `删除工序模板 ${current.operation_code}`,
    });
    response.json({ ok: true, deleted: true });
  }));

  app.post("/api/process_nodes/:id/apply-template", wrap((request, response) => {
    const templateId = Number((request.body || {}).operation_template_id);
    if (!templateId) throw ApiError.validation("operation_template_id 必填");
    const before = get("SELECT id, operation_name, operation_template_id FROM process_nodes WHERE id = ?", [request.params.id]);
    const result = applyTemplateToNode(db, Number(request.params.id), templateId);
    audit.record(db, request, {
      action: "process_node.apply_template",
      resource_type: "process_node",
      resource_id: Number(request.params.id),
      before,
      after: { operation_template_id: templateId, operation_name: result.template.operation_name, workstation_id: result.workstation_id },
      diff_summary: `节点套用工序模板 ${result.template.operation_code}`,
    });
    response.json({ ok: true, ...result });
  }));

  app.post("/api/process-master/validate-assignment", wrap((request, response) => {
    response.json(validateAssignment(db, request.body || {}));
  }));
}

module.exports = { registerOperationRoutes, normalizeOperationPayload, OPERATION_TYPES };
