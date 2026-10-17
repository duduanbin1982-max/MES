"use strict";
// 快模式按主题拆分（原 services/processTree/mindmap/views.js）
const { pickPartName, statusFromChildren, ROOT_ID } = require('../_pure');

function getPartView(db, instanceId, bomNodeId) {
  const rows = db.prepare(
    `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
            n.status, n.estimated_hours, 0 AS is_critical, n.subsystem_id,
            n.assigned_to, n.required_workstation_id
       FROM process_nodes n
       LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
       LEFT JOIN materials m ON m.id = b.material_id
      WHERE n.equipment_instance_id = ? AND n.bom_node_id = ?
      ORDER BY n.sequence, n.id`
  ).all(instanceId, bomNodeId)

  if (rows.length === 0) {
    throw Object.assign(new Error(`part bom_node_id=${bomNodeId} not found in instance ${instanceId}`), { status: 404 })
  }

  const first = rows[0]
  const partName = pickPartName(first.material_name, first.operation_name, bomNodeId)
  const subsystemId = first.subsystem_id

  const children = rows.map((n) => ({
    part_id: `node_${n.id}`,
    kind: 'operation',
    level: 4,
    name: n.operation_name,
    sequence: n.sequence,
    status: n.status,
    is_critical: false,
    estimated_hours: n.estimated_hours || 0,
    assigned_to: n.assigned_to || null,
    required_workstation_id: n.required_workstation_id || null,
    process_node_id: n.id,
    subsystem_id: n.subsystem_id,
  }))

  const breadcrumb = [{ part_id: ROOT_ID, name: '总装', level: 1 }]
  if (subsystemId != null) {
    const sub = db.prepare(`SELECT name_zh FROM equipment_subsystems WHERE id = ?`).get(subsystemId)
    breadcrumb.push({
      part_id: `sub_${subsystemId}`,
      name: sub ? sub.name_zh : `subsystem ${subsystemId}`,
      level: 2,
    })
  } else {
    breadcrumb.push({ part_id: 'sub_unassigned', name: '总装/未分类', level: 2 })
  }
  breadcrumb.push({ part_id: `part_${bomNodeId}`, name: partName, level: 3 })

  const { status, progress_pct } = statusFromChildren(children)

  return {
    current: {
      part_id: `part_${bomNodeId}`,
      kind: 'part',
      level: 3,
      bom_node_id: bomNodeId,
      name: partName,
      material_name: first.material_name || null,
      subsystem_id: subsystemId,
      child_count: children.length,
      progress_pct,
      status,
    },
    children,
    breadcrumb,
  }
}

module.exports = { getPartView };
