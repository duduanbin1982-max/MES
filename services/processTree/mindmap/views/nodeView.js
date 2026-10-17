"use strict";
// 快模式按主题拆分（原 services/processTree/mindmap/views.js）
const { pickPartName, ROOT_ID } = require('../_pure');

function getNodeView(db, instanceId, nodeId) {
  const row = db.prepare(
    `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
            n.status, n.estimated_hours, n.assigned_to, n.required_workstation_id,
            n.subsystem_id, n.notes, n.planned_start, n.planned_end,
            n.actual_start, n.actual_end
       FROM process_nodes n
       LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
       LEFT JOIN materials m ON m.id = b.material_id
      WHERE n.id = ? AND n.equipment_instance_id = ?`
  ).get(nodeId, instanceId)

  if (!row) {
    throw Object.assign(new Error(`node ${nodeId} not found in instance ${instanceId}`), { status: 404 })
  }

  const outgoing = db.prepare(
    `SELECT d.successor_id AS to_id, d.dep_type, n.operation_name AS to_name, n.status AS to_status
       FROM process_dependencies d
       JOIN process_nodes n ON n.id = d.successor_id
      WHERE d.predecessor_id = ?`
  ).all(nodeId)
  const incoming = db.prepare(
    `SELECT d.predecessor_id AS from_id, d.dep_type, n.operation_name AS from_name, n.status AS from_status
       FROM process_dependencies d
       JOIN process_nodes n ON n.id = d.predecessor_id
      WHERE d.successor_id = ?`
  ).all(nodeId)

  const childEdges = outgoing.map((e) => ({
    kind: 'edge',
    edge_kind: 'outgoing',
    part_id: `node_${e.to_id}`,
    name: e.to_name,
    status: e.to_status,
    dep_type: e.dep_type,
  }))

  const breadcrumb = [{ part_id: ROOT_ID, name: '总装', level: 1 }]
  if (row.subsystem_id != null) {
    const sub = db.prepare(`SELECT name_zh FROM equipment_subsystems WHERE id = ?`).get(row.subsystem_id)
    breadcrumb.push({
      part_id: `sub_${row.subsystem_id}`,
      name: sub ? sub.name_zh : `subsystem ${row.subsystem_id}`,
      level: 2,
    })
  } else {
    breadcrumb.push({ part_id: 'sub_unassigned', name: '总装/未分类', level: 2 })
  }
  if (row.bom_node_id != null) {
    const partName = pickPartName(row.material_name, row.operation_name, row.bom_node_id)
    breadcrumb.push({ part_id: `part_${row.bom_node_id}`, name: partName, level: 3 })
  }
  breadcrumb.push({ part_id: `node_${nodeId}`, name: row.operation_name, level: 4 })

  return {
    current: {
      part_id: `node_${nodeId}`,
      kind: 'operation',
      level: 4,
      process_node_id: nodeId,
      bom_node_id: row.bom_node_id,
      name: row.operation_name,
      material_name: row.material_name || null,
      sequence: row.sequence,
      status: row.status,
      is_critical: false,
      estimated_hours: row.estimated_hours || 0,
      assigned_to: row.assigned_to || null,
      required_workstation_id: row.required_workstation_id || null,
      subsystem_id: row.subsystem_id,
      notes: row.notes || null,
      planned_start: row.planned_start || null,
      planned_end: row.planned_end || null,
      actual_start: row.actual_start || null,
      actual_end: row.actual_end || null,
      child_count: childEdges.length,
      incoming_count: incoming.length,
    },
    children: childEdges,
    breadcrumb,
    edges: {
      incoming: incoming.map((e) => ({ ...e, part_id: `node_${e.from_id}` })),
      outgoing: childEdges,
    },
  }
}

module.exports = { getNodeView };
