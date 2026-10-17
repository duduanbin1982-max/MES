"use strict";
// services/workflow/timeline.js
// 统一读取口径（2026-10-17）：工单 / ECO / 文档 的"流转审计"来自不同的表——
//   工单   → workflow_instances + workflow_history（services/workOrder/workflowAudit 写入）
//   ECO    → workflow_instances + workflow_history（app/workflow/engine 写入）
//   文档   → document_events（services/documentService/history.js 写入）
// 本模块把它们归一成同一个返回形状，前端只写一套渲染：
//   { entity_type, entity_id, definition, entity, current_state,
//     available_actions[], sources[], history[], instances[] }
// history 行字段统一为：id, from_state, to_state, action, action_label,
//   actor_id, actor_name, comment, data, created_at, source
// 排序：history 按时间倒序（最新在前），便于时间线展示。

const { definitions } = require("../../app/workflow/definitions");

function all(db, sql, params = []) { return db.prepare(sql).all(params); }
function get(db, sql, params = []) { return db.prepare(sql).get(params); }

function definitionFor(entityType) {
  const name = Object.keys(definitions).find((n) => definitions[n].entity_type === entityType);
  return name ? { name, def: definitions[name] } : { name: null, def: null };
}

function actionLabel(def, action) {
  const t = (def?.transitions || []).find((x) => x.action === action);
  return t?.label || action;
}

function availableActions(def, state) {
  if (!def || !state) return [];
  return def.transitions
    .filter((t) => t.from === state)
    .map((t) => ({ action: t.action, label: t.label || t.action, to: t.to }));
}

/** 引擎驱动的实体（工单 / ECO）：从 workflow_instances + workflow_history 取 */
function fromWorkflowTables(db, entityType, entityId) {
  const instances = all(
    db,
    "SELECT * FROM workflow_instances WHERE entity_type = ? AND entity_id = ? ORDER BY id",
    [entityType, entityId]
  );
  const rows = [];
  // 每个实例也带上自己的 history（兼容既有调用方与前端旧渲染）
  const withHistory = instances.map((inst) => {
    const own = all(db, "SELECT * FROM workflow_history WHERE instance_id = ? ORDER BY id", [inst.id]).map((h) => ({
      id: h.id,
      from_state: h.from_state,
      to_state: h.to_state,
      action: h.action,
      actor_id: h.actor_id,
      comment: h.comment || null,
      data: h.data || null,
      created_at: h.created_at,
      source: "workflow_instances",
    }));
    rows.push(...own);
    return { ...inst, history: own };
  });
  return { instances: withHistory, rows };
}

/** 文档：从 document_events 取（action / from_status / to_status / reason / issued_to） */
function fromDocumentEvents(db, entityId) {
  const rows = all(
    db,
    "SELECT id, action, from_status, to_status, version, issued_to, reason, operator_id, created_at FROM document_events WHERE doc_id = ? ORDER BY id",
    [entityId]
  ).map((e) => ({
    id: e.id,
    from_state: e.from_status,
    to_state: e.to_status,
    action: e.action,
    actor_id: e.operator_id,
    comment: e.reason || e.issued_to || null,
    data: JSON.stringify({ version: e.version, issued_to: e.issued_to }),
    created_at: e.created_at,
    source: "document_events",
  }));
  return { instances: [], rows };
}

function sortDesc(rows) {
  return rows.sort((a, b) => {
    const ta = String(a.created_at || "");
    const tb = String(b.created_at || "");
    if (ta !== tb) return tb.localeCompare(ta);
    return (b.id || 0) - (a.id || 0);
  });
}

function getTimeline(db, entityType, entityId) {
  const type = String(entityType || "");
  const id = Number(entityId);
  const { name: defName, def } = definitionFor(type);

  let entity = null;
  let current = null;
  let payload;
  const sources = [];

  if (type === "work_order") {
    entity = get(db, "SELECT id, wo_code, title, status FROM work_orders WHERE id = ?", [id]);
    current = entity ? entity.status : null;
    payload = fromWorkflowTables(db, type, id);
    sources.push("workflow_instances");
  } else if (type === "document") {
    entity = get(db, "SELECT id, doc_no, doc_name, title, status FROM documents WHERE id = ?", [id]);
    current = entity ? entity.status : null;
    payload = fromDocumentEvents(db, id);
    sources.push("document_events");
  } else {
    payload = fromWorkflowTables(db, type, id);
    sources.push("workflow_instances");
    if (payload.instances.length) current = payload.instances[payload.instances.length - 1].current_state;
  }

  const history = sortDesc(payload.rows).map((r) => ({
    ...r,
    action_label: actionLabel(def, r.action),
    actor_name: null,
  }));

  // 补操作人姓名（一次性 join，避免逐行查）
  const ids = [...new Set(history.map((h) => h.actor_id).filter((x) => x != null))];
  if (ids.length) {
    const map = new Map(
      all(db, `SELECT id, full_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).map((u) => [u.id, u.full_name])
    );
    for (const h of history) if (h.actor_id != null) h.actor_name = map.get(h.actor_id) || null;
  }

  return {
    entity_type: type,
    entity_id: id,
    definition: defName,
    entity: entity || null,
    current_state: current,
    available_actions: availableActions(def, current),
    sources,
    history,
    instances: payload.instances,
  };
}

module.exports = { getTimeline, definitionFor, availableActions, actionLabel };
