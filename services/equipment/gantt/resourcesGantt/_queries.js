"use strict";
// services/equipment/gantt/resourcesGantt/_queries.js
// 取工单/工序源行（带/不带 instance_id 过滤两套 SQL）。
// (原 services/equipment/gantt/resourcesGantt.js 第 95-132 行)
//
// 2026-11-05（审计 F-03）：工单原先用 `NULL AS planned_end`，且过滤条件只认 planned_start /
// actual_start —— 导致"只有计划结束时间"的工单完全看不到。现在取真实 planned_end 并放宽过滤条件，
// 起止时间的推导交给 _items.normalizeItem（缺开始时间时用 planned_end - 工时回推）。

const { all } = require("./_items");

const WORK_ORDER_FILTER = "(wo.planned_start IS NOT NULL OR wo.planned_end IS NOT NULL OR wo.actual_start IS NOT NULL OR wo.actual_end IS NOT NULL)";
const PROCESS_NODE_FILTER = "(pn.planned_start IS NOT NULL OR pn.planned_end IS NOT NULL OR pn.actual_start IS NOT NULL OR pn.actual_end IS NOT NULL)";

function loadSourceRows(db, instanceFilter) {
  const workOrderSql = instanceFilter
    ? `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, wo.planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE ei.id = ? AND ${WORK_ORDER_FILTER}`
    : `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, wo.planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE ${WORK_ORDER_FILTER}`;

  const processNodeSql = instanceFilter
    ? `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE ei.id = ? AND ${PROCESS_NODE_FILTER}`
    : `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE ${PROCESS_NODE_FILTER}`;

  const workOrders = all(db, workOrderSql, ...(instanceFilter ? [instanceFilter] : []));
  const processNodes = all(db, processNodeSql, ...(instanceFilter ? [instanceFilter] : []));

  return { workOrders, processNodes };
}

module.exports = { loadSourceRows };
