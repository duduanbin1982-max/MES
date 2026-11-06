"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { requirePermission } = require("../../middleware/auth");
const audit = require("../../app/audit");

// 2026-11-07（ECO/工艺审计）：状态机约束 —— 只有 open/review 允许改字段；
// approved/implemented/closed/rejected 视为冻结，必须走流程回退（当前定义没有回退边）。
const EDITABLE_STATUSES = new Set(["open", "review"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function assertText(value, field, { required = false, max = 200 } = {}) {
  const text = normalizeText(value);
  if (!text) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (text.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return text;
}

function normalizeDate(value, field) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw ApiError.validation(`${field} 需为 YYYY-MM-DD 格式的有效日期`);
  }
  return text;
}

function validateEcoPayload(body, { partial = false } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("eco_no")) {
    payload.eco_no = assertText(source.eco_no, "eco_no", { required: true, max: 64 });
  }
  if (!partial || has("title")) {
    payload.title = assertText(source.title, "title", { required: true, max: 200 });
  }
  if (!partial || has("reason")) payload.reason = assertText(source.reason, "reason", { max: 2000 });
  if (!partial || has("affected_scope")) payload.affected_scope = assertText(source.affected_scope, "affected_scope", { max: 500 });
  if (!partial || has("effective_date")) payload.effective_date = normalizeDate(source.effective_date, "effective_date");
  return payload;
}

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  } catch (_error) {
    return false;
  }
}

// 兼容精简测试库：没有 equipment_instances 表时跳过实例存在校验（生产库始终存在）。
function assertInstance(db, instanceId) {
  if (!tableExists(db, "equipment_instances")) return;
  const row = db.prepare("SELECT id FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!row) throw ApiError.notFound("装备实例不存在");
}

function assertUniqueEcoNo(db, instanceId, ecoNo, excludeId = null) {
  const row = db.prepare(
    "SELECT id FROM instance_eco WHERE equipment_instance_id = ? AND eco_no = ? AND id <> ?"
  ).get(instanceId, ecoNo, excludeId || 0);
  if (row) throw ApiError.conflict(`ECO 编号 ${ecoNo} 在该装备实例下已存在（id=${row.id}）`);
}

function actorId(req) {
  if (!req || !req.user) return null;
  const id = req.user.sub != null ? req.user.sub : req.user.uid;
  return id == null ? null : Number(id);
}

function registerEcoRoutes(app, context, buildImpact) {
  const { db, all, get, run } = context;

  app.get("/api/equipment_instances/:id/eco", wrap((req, res) => {
    res.json(all("SELECT * FROM instance_eco WHERE equipment_instance_id = ? ORDER BY id DESC", req.params.id));
  }));

  app.post("/api/equipment_instances/:id/eco", wrap((req, res) => {
    const instanceId = Number(req.params.id);
    if (!Number.isInteger(instanceId) || instanceId <= 0) throw ApiError.validation("装备实例 ID 非法");
    assertInstance(db, instanceId);
    const payload = validateEcoPayload(req.body, { partial: false });
    assertUniqueEcoNo(db, instanceId, payload.eco_no);
    const createdBy = actorId(req) || (req.body && req.body.created_by) || null;
    const result = run(
      "INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [instanceId, payload.eco_no, payload.title, payload.reason, payload.affected_scope, payload.effective_date, createdBy]
    );
    audit.record(db, req, {
      action: "eco.create",
      resource_type: "instance_eco",
      resource_id: result.lastInsertRowid,
      after: { equipment_instance_id: instanceId, ...payload },
      diff_summary: `创建 ECO ${payload.eco_no}`,
    });
    res.json({ id: result.lastInsertRowid });
  }));

  app.get("/api/instance_eco/:id/impact", wrap((req, res) => {
    const eco = get("SELECT * FROM instance_eco WHERE id = ?", req.params.id);
    if (!eco) throw ApiError.notFound("ECO 不存在");
    res.json(buildImpact(eco));
  }));

  app.put("/api/instance_eco/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("ECO ID 非法");
    const before = get("SELECT * FROM instance_eco WHERE id = ?", id);
    if (!before) throw ApiError.notFound("ECO 不存在");
    const status = String(before.status || "open");
    if (!EDITABLE_STATUSES.has(status)) {
      throw ApiError.conflict(`ECO 当前状态 "${status}" 不允许编辑，仅 open/review 可修改`);
    }
    const payload = validateEcoPayload(req.body, { partial: true });
    const assignments = [];
    const params = [];
    for (const [field, value] of Object.entries(payload)) {
      assignments.push(`${field} = ?`);
      params.push(value);
    }
    if (!assignments.length) throw ApiError.validation("无可更新字段");
    assignments.push("updated_at = datetime('now')");
    params.push(id);
    const result = run(`UPDATE instance_eco SET ${assignments.join(", ")} WHERE id = ?`, params);
    audit.record(db, req, {
      action: "eco.update",
      resource_type: "instance_eco",
      resource_id: id,
      before: { eco_no: before.eco_no, title: before.title, effective_date: before.effective_date, affected_scope: before.affected_scope },
      after: payload,
      diff_summary: `更新 ECO ${before.eco_no}`,
    });
    res.json({ changes: result.changes });
  }));
}

function registerWorkflowRoutes(app, context, workflow, archiveDocuments) {
  const { db, get, run } = context;
  // 2026-11-07（ECO 审计）：此前 POST /instance_eco/:id/transit 未命中 apiPermissions 任何规则，
  // 任意登录用户都能审批 ECO。apiPermissions 属共享文件，故在服务内补同等的写权限校验。
  app.post("/api/instance_eco/:id/transit", requirePermission("equipment:write", "process:write"), wrap((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("ECO ID 非法");
    const body = req.body || {};
    const action = assertText(body.action, "action", { required: true, max: 40 });
    const comment = assertText(body.comment, "comment", { max: 500 });
    const effectiveDate = normalizeDate(body.effective_date, "effective_date");
    const closedDate = normalizeDate(body.closed_date, "closed_date");
    let instance = db.prepare("SELECT * FROM workflow_instances WHERE entity_type = 'eco' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(id);
    const eco = get("SELECT * FROM instance_eco WHERE id = ?", id);
    if (!instance && !eco) throw ApiError.notFound("ECO 不存在");
    if (!instance) {
      instance = workflow.start("eco_change", "eco", id, {
        assigned_to: actorId(req),
        data: { eco_no: eco.eco_no, title: eco.title },
        created_by: actorId(req),
        comment: `从 ${eco.status || "open"} 迁移`,
      }).instance;
    }
    const beforeState = instance.current_state;
    const extra = {};
    if (effectiveDate) extra.effective_date = effectiveDate;
    if (closedDate) extra.closed_date = closedDate;
    const result = workflow.transit(Number(instance.id), action, actorId(req), comment, extra);
    const newState = result.instance.current_state;
    if (newState) {
      const assignments = ["status = ?", "updated_at = datetime('now')"];
      const params = [newState];
      if (effectiveDate) { assignments.push("effective_date = ?"); params.push(effectiveDate); }
      if (closedDate) { assignments.push("closed_date = ?"); params.push(closedDate); }
      params.push(id);
      run(`UPDATE instance_eco SET ${assignments.join(", ")} WHERE id = ?`, params);
      archiveDocuments(id, newState);
      audit.record(db, req, {
        action: "eco.transit",
        resource_type: "instance_eco",
        resource_id: id,
        before: { status: beforeState },
        after: { status: newState, action, effective_date: effectiveDate, closed_date: closedDate },
        diff_summary: `${beforeState} -> ${newState} (${action})`,
      });
    }
    res.json(result);
  }));
}

module.exports = { registerEcoRoutes, registerWorkflowRoutes, validateEcoPayload, EDITABLE_STATUSES };
