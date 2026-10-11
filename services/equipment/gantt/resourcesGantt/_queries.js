"use strict";
// services/equipment/gantt/resourcesGantt/_queries.js
// 取工单/工序源行（带/不带 instance_id 过滤两套 SQL）。
// (原 services/equipment/gantt/resourcesGantt.js 第 95-132 行)

const { all } = require("./_items");

function loadSourceRows(db, instanceFilter) {
  const workOrderSql = instanceFilter
    ? `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, NULL AS planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE ei.id = ? AND (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)`
    : `SELECT wo.id, wo.wo_code, wo.title, wo.estimated_hours, wo.actual_start, wo.actual_end,
              wo.planned_start, NULL AS planned_end, wo.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM work_orders wo
       LEFT JOIN workstations ws ON wo.workstation_id = ws.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE (wo.planned_start IS NOT NULL OR wo.actual_start IS NOT NULL)`;

  const processNodeSql = instanceFilter
    ? `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE ei.id = ? AND (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)`
    : `SELECT pn.id, pn.operation_name, pn.estimated_hours, pn.planned_start, pn.planned_end,
              pn.actual_start, pn.actual_end, pn.status,
              ws.name AS ws_name, ws.id AS ws_id,
              ei.id AS instance_id, ei.instance_code, ei.instance_name
       FROM process_nodes pn
       LEFT JOIN workstations ws ON pn.required_workstation_id = ws.id
       JOIN equipment_instances ei ON pn.equipment_instance_id = ei.id
       WHERE (pn.planned_start IS NOT NULL OR pn.actual_start IS NOT NULL)`;

  const workOrders = all(db, workOrderSql, ...(instanceFilter ? [instanceFilter] : []));
  const processNodes = all(db, processNodeSql, ...(instanceFilter ? [instanceFilter] : []));

  return { workOrders, processNodes };
}

module.exports = { loadSourceRows };
