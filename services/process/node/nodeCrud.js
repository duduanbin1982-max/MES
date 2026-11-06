"use strict";
// services/process/node/nodeCrud.js
// 工艺节点 CRUD + 实例工艺树
//   GET    /api/equipment_instances/:id/process_tree
//   POST   /api/process_nodes
//   PUT    /api/process_nodes/:id
//   DELETE /api/process_nodes/:id
//   GET    /api/process_nodes/:id
// Author: 三狗子 | Date: 2026-06-24
// 2026-11-07（工艺树审计）：补父节点同实例/环校验、BOM 归属校验、数值边界、
//   布尔字段绑定修复（better-sqlite3 不接受 true/false）、删除引用保护 + 级联清理 + 审计。

const { all, get, run, wrap } = require("./_helpers");
const { emit, Events } = require("../../../app/ws/EventBus");
const { ApiError } = require("../../../app/errors");
const audit = require("../../../app/audit");

const NODE_STATUSES = new Set(["pending", "ready", "in_progress", "paused", "blocked", "completed", "cancelled", "skipped"]);
const MAX_HOURS = 100000;
const MAX_WORKERS = 1000;

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  } catch (_error) {
    return false;
  }
}

function toNumber(value, field, { min = 0, max = MAX_HOURS, integer = false } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.validation(`${field} 必须是数字`);
  if (num < min || num > max) throw ApiError.validation(`${field} 需在 ${min}~${max} 之间`);
  if (integer && !Number.isInteger(num)) throw ApiError.validation(`${field} 必须是整数`);
  return num;
}

function toText(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (text.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return text;
}

function toBool(value) {
  if (value === true || value === 1) return 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized) ? 1 : 0;
  }
  return value ? 1 : 0;
}

function toDate(value, field) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (Number.isNaN(Date.parse(text))) throw ApiError.validation(`${field} 需为有效日期`);
  return text;
}

function nodeRow(db, id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return get(db, "SELECT * FROM process_nodes WHERE id = ?", numeric);
}

function assertInstance(db, instanceId) {
  if (!tableExists(db, "equipment_instances")) return;
  const row = db.prepare("SELECT id FROM equipment_instances WHERE id = ?").get(instanceId);
  if (!row) throw ApiError.notFound("装备实例不存在");
}

// 父节点必须存在、同实例、不能成环。返回规范化后的 parent_id（null 表示根）。
function resolveParentId(db, parentId, { node = null, instanceId = null } = {}) {
  if (parentId === undefined || parentId === null || parentId === "") return null;
  const pid = Number(parentId);
  if (!Number.isInteger(pid) || pid <= 0) throw ApiError.validation("parent_id 非法");
  const parent = nodeRow(db, pid);
  if (!parent) throw ApiError.validation(`父节点不存在：${pid}`);
  if (node && Number(node.id) === pid) throw ApiError.validation("节点不能作为自己的父节点");
  const targetInstance = instanceId == null ? (node ? node.equipment_instance_id : parent.equipment_instance_id) : instanceId;
  if (Number(parent.equipment_instance_id) !== Number(targetInstance)) {
    throw ApiError.validation("父节点必须属于同一装备实例");
  }
  const seen = new Set([pid]);
  let current = parent;
  while (current && current.parent_id != null) {
    const nextId = Number(current.parent_id);
    if (node && nextId === Number(node.id)) {
      throw ApiError.validation("不能把节点移动到自己的子孙节点下（会形成环）");
    }
    if (seen.has(nextId)) break;
    seen.add(nextId);
    current = nodeRow(db, nextId);
  }
  return pid;
}

function resolveBomNode(db, bomId, instanceId) {
  if (bomId === undefined || bomId === null || bomId === "") return null;
  const id = Number(bomId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("bom_node_id 非法");
  if (!tableExists(db, "instance_bom")) return id;
  const row = db.prepare("SELECT id, equipment_instance_id FROM instance_bom WHERE id = ?").get(id);
  if (!row) throw ApiError.validation(`BOM 节点不存在：${id}`);
  if (Number(row.equipment_instance_id) !== Number(instanceId)) {
    throw ApiError.validation("BOM 节点不属于该装备实例");
  }
  return id;
}

function resolveTemplate(db, templateId) {
  if (templateId === undefined || templateId === null || templateId === "") return null;
  const id = Number(templateId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("operation_template_id 非法");
  if (!tableExists(db, "process_operation_templates")) return id;
  const row = db.prepare("SELECT id, is_active FROM process_operation_templates WHERE id = ?").get(id);
  if (!row) throw ApiError.validation(`工序模板不存在：${id}`);
  if (!row.is_active) throw ApiError.validation(`工序模板已停用：${id}`);
  return id;
}

function resolvePositionCode(db, code) {
  if (code === undefined || code === null || code === "") return null;
  const value = String(code).trim();
  if (!value) return null;
  if (!tableExists(db, "process_positions")) return value;
  const row = db.prepare("SELECT position_code, is_active FROM process_positions WHERE position_code = ?").get(value);
  if (!row) throw ApiError.validation(`岗位不存在：${value}`);
  if (!row.is_active) throw ApiError.validation(`岗位已停用：${value}`);
  return value;
}

function resolveWorkstation(db, workstationId) {
  if (workstationId === undefined || workstationId === null || workstationId === "") return null;
  const id = Number(workstationId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.validation("required_workstation_id 非法");
  if (!tableExists(db, "workstations")) return id;
  const row = db.prepare("SELECT id FROM workstations WHERE id = ?").get(id);
  if (!row) throw ApiError.validation(`工位不存在：${id}`);
  return id;
}

function safeCount(db, sql, params = []) {
  try { return db.prepare(sql).get(params).c || 0; } catch (_error) { return 0; }
}

function register(app, db) {
  app.get('/api/equipment_instances/:id/process_tree', wrap((req, res) => {
    const rows = all(db, 'SELECT * FROM process_nodes WHERE equipment_instance_id = ? ORDER BY sort_order, id', req.params.id);
    const bomMap = {};
    all(db, 'SELECT id, material_id, quantity, is_key_component FROM instance_bom WHERE equipment_instance_id = ?', req.params.id)
      .forEach((b) => bomMap[b.id] = b);
    const matMap = {};
    all(db, 'SELECT id, material_name FROM materials').forEach((m) => matMap[m.id] = m);
    const wsMap = {};
    all(db, 'SELECT id, name FROM workstations').forEach((w) => wsMap[w.id] = w);
    const deps = all(db, 'SELECT * FROM process_dependencies WHERE equipment_instance_id = ?', req.params.id);
    const enriched = rows.map((n) => {
      const bom = n.bom_node_id ? bomMap[n.bom_node_id] : null;
      const mat = bom && bom.material_id ? matMap[bom.material_id] : null;
      return Object.assign({}, n, {
        bom_quantity: bom ? bom.quantity : null,
        bom_is_key: bom ? !!bom.is_key_component : false,
        material_name: mat ? mat.material_name : null,
        workstation_name: n.required_workstation_id ? wsMap[n.required_workstation_id] : null,
        predecessors: deps.filter((d) => d.successor_id === n.id).map((d) => d.predecessor_id),
        successors: deps.filter((d) => d.predecessor_id === n.id).map((d) => d.successor_id)
      });
    });
    const map = {};
    enriched.forEach((n) => { n.children = []; map[n.id] = n; });
    const roots = [];
    enriched.forEach((n) => {
      if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(n);
      else roots.push(n);
    });
    res.json({ flat: enriched, tree: roots, deps: deps });
  }));

  // 工艺节点 CRUD
  app.post('/api/process_nodes', wrap((req, res) => {
    const body = req.body || {};
    const instanceId = toNumber(body.equipment_instance_id, "equipment_instance_id", { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true });
    if (!instanceId) throw ApiError.validation("equipment_instance_id/operation_name 必填");
    assertInstance(db, instanceId);
    const operationName = toText(body.operation_name, "operation_name", { required: true, max: 200 });
    const parentId = resolveParentId(db, body.parent_id, { instanceId });
    const bomId = resolveBomNode(db, body.bom_node_id, instanceId);
    const templateId = resolveTemplate(db, body.operation_template_id);
    const positionCode = resolvePositionCode(db, body.required_position_code);
    const workstationId = resolveWorkstation(db, body.required_workstation_id);
    const payload = {
      equipment_instance_id: instanceId,
      parent_id: parentId,
      bom_node_id: bomId,
      operation_name: operationName,
      operation_type: toText(body.operation_type, "operation_type", { max: 40 }) || "make",
      sequence: toNumber(body.sequence, "sequence", { min: 0, max: 1000000, integer: true }) || 1,
      estimated_hours: toNumber(body.estimated_hours, "estimated_hours", { min: 0, max: MAX_HOURS }) || 0,
      required_workstation_id: workstationId,
      required_skill: toText(body.required_skill, "required_skill", { max: 100 }),
      operation_template_id: templateId,
      required_position_code: positionCode,
      worker_count: toNumber(body.worker_count, "worker_count", { min: 1, max: MAX_WORKERS, integer: true }) || 1,
      qc_required: toBool(body.qc_required),
      sop_required: toBool(body.sop_required),
      is_milestone: toBool(body.is_milestone),
      phase_code: toText(body.phase_code, "phase_code", { max: 50 }),
      planned_start: toDate(body.planned_start, "planned_start"),
      planned_end: toDate(body.planned_end, "planned_end"),
      notes: toText(body.notes, "notes", { max: 2000 }),
    };
    if (payload.planned_start && payload.planned_end && Date.parse(payload.planned_end) < Date.parse(payload.planned_start)) {
      throw ApiError.validation("planned_end 不能早于 planned_start");
    }
    const r = run(db,
      "INSERT INTO process_nodes (equipment_instance_id, parent_id, bom_node_id, operation_name, operation_type, sequence, estimated_hours, required_workstation_id, required_skill, operation_template_id, required_position_code, worker_count, qc_required, sop_required, is_milestone, phase_code, planned_start, planned_end, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [payload.equipment_instance_id, payload.parent_id, payload.bom_node_id, payload.operation_name, payload.operation_type,
       payload.sequence, payload.estimated_hours, payload.required_workstation_id, payload.required_skill,
       payload.operation_template_id, payload.required_position_code, payload.worker_count, payload.qc_required,
       payload.sop_required, payload.is_milestone, payload.phase_code, payload.planned_start, payload.planned_end, payload.notes]
    );
    audit.record(db, req, {
      action: "process_node.create",
      resource_type: "process_node",
      resource_id: r.lastInsertRowid,
      after: payload,
      diff_summary: `创建工序节点 ${payload.operation_name}`,
    });
    emit(Events.BOM_CREATED, { node_id: r.lastInsertRowid, node_name: operationName, equipment_instance_id: instanceId, parent_id: parentId, bom_node_id: bomId });
    res.json({ id: r.lastInsertRowid, message: '工艺节点已创建' });
  }));

  app.put('/api/process_nodes/:id', wrap((req, res) => {
    const before = nodeRow(db, req.params.id);
    if (!before) throw ApiError.notFound("工艺节点不存在");
    const body = req.body || {};
    const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
    const updates = [];
    const values = [];
    const set = (field, value) => { updates.push(`${field} = ?`); values.push(value); };

    if (has("operation_name")) set("operation_name", toText(body.operation_name, "operation_name", { required: true, max: 200 }));
    if (has("operation_type")) set("operation_type", toText(body.operation_type, "operation_type", { required: true, max: 40 }));
    if (has("sequence")) set("sequence", toNumber(body.sequence, "sequence", { min: 0, max: 1000000, integer: true }));
    if (has("estimated_hours")) set("estimated_hours", toNumber(body.estimated_hours, "estimated_hours", { min: 0, max: MAX_HOURS }));
    if (has("worker_count")) set("worker_count", toNumber(body.worker_count, "worker_count", { min: 1, max: MAX_WORKERS, integer: true }));
    if (has("sort_order")) set("sort_order", toNumber(body.sort_order, "sort_order", { min: 0, max: 1000000, integer: true }));
    if (has("planned_cost")) set("planned_cost", toNumber(body.planned_cost, "planned_cost", { min: 0, max: Number.MAX_SAFE_INTEGER }));
    if (has("actual_cost")) set("actual_cost", toNumber(body.actual_cost, "actual_cost", { min: 0, max: Number.MAX_SAFE_INTEGER }));
    if (has("required_workstation_id")) set("required_workstation_id", resolveWorkstation(db, body.required_workstation_id));
    if (has("required_skill")) set("required_skill", toText(body.required_skill, "required_skill", { max: 100 }));
    if (has("operation_template_id")) set("operation_template_id", resolveTemplate(db, body.operation_template_id));
    if (has("required_position_code")) set("required_position_code", resolvePositionCode(db, body.required_position_code));
    if (has("qc_required")) set("qc_required", toBool(body.qc_required));
    if (has("sop_required")) set("sop_required", toBool(body.sop_required));
    if (has("is_milestone")) set("is_milestone", toBool(body.is_milestone));
    if (has("phase_code")) set("phase_code", toText(body.phase_code, "phase_code", { max: 50 }));
    if (has("notes")) set("notes", toText(body.notes, "notes", { max: 2000 }));
    if (has("planned_start")) set("planned_start", toDate(body.planned_start, "planned_start"));
    if (has("planned_end")) set("planned_end", toDate(body.planned_end, "planned_end"));
    if (has("actual_start")) set("actual_start", toDate(body.actual_start, "actual_start"));
    if (has("actual_end")) set("actual_end", toDate(body.actual_end, "actual_end"));
    if (has("status")) {
      const status = String(body.status || "").trim();
      if (!NODE_STATUSES.has(status)) throw ApiError.validation(`status 必须是 ${[...NODE_STATUSES].join(" / ")}`);
      set("status", status);
    }
    if (has("parent_id")) set("parent_id", resolveParentId(db, body.parent_id, { node: before }));
    if (has("bom_node_id")) set("bom_node_id", resolveBomNode(db, body.bom_node_id, before.equipment_instance_id));

    if (!updates.length) throw ApiError.validation("无可更新字段");
    updates.push("updated_at = datetime('now')");
    values.push(before.id);
    const r = run(db, 'UPDATE process_nodes SET ' + updates.join(', ') + ' WHERE id = ?', values);
    audit.record(db, req, {
      action: "process_node.update",
      resource_type: "process_node",
      resource_id: before.id,
      before: { operation_name: before.operation_name, estimated_hours: before.estimated_hours, parent_id: before.parent_id, status: before.status },
      after: body,
      diff_summary: `更新工序节点 ${body.operation_name || before.operation_name}`,
    });
    emit(Events.BOM_UPDATED, { node_id: before.id, node_name: body.operation_name || before.operation_name, equipment_instance_id: before.equipment_instance_id, action: "updated" });
    res.json({ changes: r.changes, message: '已更新' });
  }));

  app.delete('/api/process_nodes/:id', wrap((req, res) => {
    const node = nodeRow(db, req.params.id);
    if (!node) throw ApiError.notFound("工艺节点不存在");
    const children = safeCount(db, 'SELECT COUNT(*) AS c FROM process_nodes WHERE parent_id = ?', [node.id]);
    if (children > 0) {
      throw ApiError.conflict(`节点下还有 ${children} 个子节点，请先移动或删除子节点`);
    }
    const referenced = [];
    const workOrderRefs = safeCount(db, 'SELECT COUNT(*) AS c FROM work_orders WHERE process_node_id = ?', [node.id]);
    if (workOrderRefs > 0) referenced.push(`${workOrderRefs} 个工单`);
    const scheduleRefs = safeCount(db, 'SELECT COUNT(*) AS c FROM schedule_assignments WHERE process_node_id = ?', [node.id]);
    if (scheduleRefs > 0) referenced.push(`${scheduleRefs} 条排程分配`);
    const reportRefs = safeCount(db, 'SELECT COUNT(*) AS c FROM work_report_details WHERE process_node_id = ?', [node.id]);
    if (reportRefs > 0) referenced.push(`${reportRefs} 条报工明细`);
    if (referenced.length) {
      throw ApiError.conflict(`工序节点已被 ${referenced.join("、")} 引用，不能删除；请先解除引用`);
    }
    const cascade = {};
    const tx = db.transaction(() => {
      cascade.dependencies = run(db, 'DELETE FROM process_dependencies WHERE predecessor_id = ? OR successor_id = ?', [node.id, node.id]).changes;
      cascade.executions = run(db, 'DELETE FROM process_executions WHERE process_node_id = ?', [node.id]).changes;
      cascade.params = run(db, 'DELETE FROM process_params WHERE process_node_id = ?', [node.id]).changes;
      if (tableExists(db, "process_standard_hours")) {
        cascade.standard_hours = run(db, 'DELETE FROM process_standard_hours WHERE process_node_id = ?', [node.id]).changes;
      }
      if (tableExists(db, "spc_alerts")) {
        cascade.spc_alerts = run(db, 'DELETE FROM spc_alerts WHERE process_node_id = ?', [node.id]).changes;
      }
      cascade.node = run(db, 'DELETE FROM process_nodes WHERE id = ?', [node.id]).changes;
      return cascade;
    });
    const result = tx();
    audit.record(db, req, {
      action: "process_node.delete",
      resource_type: "process_node",
      resource_id: node.id,
      before: { operation_name: node.operation_name, equipment_instance_id: node.equipment_instance_id, bom_node_id: node.bom_node_id, status: node.status },
      after: { cascaded: cascade },
      diff_summary: `删除工序节点 ${node.operation_name}（级联 ${JSON.stringify(cascade)}）`,
    });
    emit(Events.BOM_UPDATED, { node_id: node.id, node_name: node.operation_name, equipment_instance_id: node.equipment_instance_id, action: "deleted" });
    res.json({ changes: result.node, cascaded: cascade, message: '已删除' });
  }));

  app.get('/api/process_nodes/:id', wrap((req, res) => {
    const n = get(db, 'SELECT * FROM process_nodes WHERE id = ?', req.params.id);
    if (!n) throw ApiError.notFound("工艺节点不存在");
    n.executions = all(db, 'SELECT pe.*, u.full_name as operator_name FROM process_executions pe LEFT JOIN users u ON pe.operator_id = u.id WHERE pe.process_node_id = ? ORDER BY pe.timestamp', req.params.id);
    n.predecessors = all(db, 'SELECT * FROM process_dependencies WHERE successor_id = ?', req.params.id);
    n.successors = all(db, 'SELECT * FROM process_dependencies WHERE predecessor_id = ?', req.params.id);
    res.json(n);
  }));

  // 工艺执行 (扫码报工)
}

module.exports = { register, resolveParentId, resolveBomNode, NODE_STATUSES };
