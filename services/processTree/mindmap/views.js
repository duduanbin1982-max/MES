// services/processTree/mindmap/views.js
// 4 个 Mindmap 视图函数，统一在文件末尾导出。
//   getRootView / getSubsystemView / getPartView / getNodeView
'use strict';

const { pickPartName, deriveStatus, statusFromChildren, ROOT_ID } = require('./_pure');

// ============================================================
// getRootView
// ============================================================
function getRootView(db, instanceId) {
  const totalNodes = db.prepare(
    `SELECT COUNT(*) AS c FROM process_nodes WHERE equipment_instance_id = ?`
  ).get(instanceId).c
  const completed = db.prepare(
    `SELECT COUNT(*) AS c FROM process_nodes WHERE equipment_instance_id = ? AND status = 'completed'`
  ).get(instanceId).c
  const inProgress = db.prepare(
    `SELECT COUNT(*) AS c FROM process_nodes WHERE equipment_instance_id = ? AND status = 'in_progress'`
  ).get(instanceId).c
  const subsystems = db.prepare(
    `SELECT id, code, name_zh, name_en, sequence FROM equipment_subsystems ORDER BY sequence ASC, id ASC`
  ).all()

  const childCounts = db.prepare(
    `SELECT subsystem_id, COUNT(DISTINCT bom_node_id) AS parts, COUNT(*) AS ops
       FROM process_nodes WHERE equipment_instance_id = ? GROUP BY subsystem_id`
  ).all(instanceId)

  const unassigned = db.prepare(
    `SELECT COUNT(DISTINCT bom_node_id) AS parts, COUNT(*) AS ops
       FROM process_nodes WHERE equipment_instance_id = ? AND subsystem_id IS NULL`
  ).get(instanceId)

  const children = []
  for (const s of subsystems) {
    const c = childCounts.find((x) => x.subsystem_id === s.id) || { parts: 0, ops: 0 }
    children.push({
      part_id: `sub_${s.id}`,
      kind: 'subsystem',
      name: s.name_zh,
      name_en: s.name_en,
      sequence: s.sequence,
      level: 2,
      child_count: c.parts,
      op_count: c.ops,
      subsystem_id: s.id,
    })
  }
  if (unassigned && unassigned.parts > 0) {
    children.push({
      part_id: 'sub_unassigned',
      kind: 'subsystem',
      name: '总装/未分类',
      name_en: 'Final Assembly / Unassigned',
      sequence: 99,
      level: 2,
      child_count: unassigned.parts,
      op_count: unassigned.ops,
      subsystem_id: null,
    })
  }

  return {
    current: {
      part_id: ROOT_ID,
      kind: 'root',
      name: '总装',
      level: 1,
      child_count: children.length,
      status: totalNodes > 0 && completed === totalNodes ? 'completed' : 'in_progress',
      progress_pct: totalNodes === 0 ? 0 : Math.round((completed * 100) / totalNodes),
      total_nodes: totalNodes,
      completed_nodes: completed,
      in_progress_nodes: inProgress,
    },
    children,
    breadcrumb: [{ part_id: ROOT_ID, name: '总装', level: 1 }],
  }
}


function aggregatePartsByBomId(nodes) {
  const byBomId = new Map();
  for (const node of nodes) {
    if (node.bom_node_id == null) continue;
    if (!byBomId.has(node.bom_node_id)) {
      byBomId.set(node.bom_node_id, {
        part_id: `part_${node.bom_node_id}`,
        kind: 'part',
        level: 3,
        bom_node_id: node.bom_node_id,
        name: pickPartName(node.material_name, node.operation_name, node.bom_node_id),
        material_name: node.material_name || null,
        sequence: node.sequence || 0,
        child_count: 0,
        op_count: 0,
        estimated_hours: 0,
        is_critical: false,
        children: [],
      });
    }
    const part = byBomId.get(node.bom_node_id);
    part.sequence = Math.min(part.sequence || node.sequence || 0, node.sequence || 0);
    part.child_count += 1;
    part.op_count += 1;
    part.estimated_hours += Number(node.estimated_hours || 0);
    part.is_critical = part.is_critical || Boolean(node.is_critical);
    part.children.push({ status: node.status });
  }

  return Array.from(byBomId.values())
    .map((part) => {
      const { status, progress_pct } = statusFromChildren(part.children);
      delete part.children;
      return { ...part, status, progress_pct };
    })
    .sort((a, b) => (a.sequence - b.sequence) || (a.bom_node_id - b.bom_node_id));
}

function getSubsystemView(db, instanceId, subsystemId) {
  const isUnassigned = !Number.isFinite(subsystemId)
  const subRow = isUnassigned
    ? null
    : db.prepare(
        `SELECT id, code, name_zh, name_en, sequence FROM equipment_subsystems WHERE id = ?`
      ).get(subsystemId)
  if (!isUnassigned && !subRow) {
    throw Object.assign(new Error(`subsystem ${subsystemId} not found`), { status: 404 })
  }

  const where = isUnassigned
    ? 'AND n.subsystem_id IS NULL'
    : 'AND n.subsystem_id = ?'
  const params = isUnassigned ? [instanceId] : [instanceId, subsystemId]
  const nodes = db.prepare(
    `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
            n.status, n.estimated_hours, 0 AS is_critical
       FROM process_nodes n
       LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
       LEFT JOIN materials m ON m.id = b.material_id
      WHERE n.equipment_instance_id = ? ${where}
      ORDER BY n.bom_node_id, n.sequence`
  ).all(...params)

  const children = aggregatePartsByBomId(nodes)

  return {
    current: {
      part_id: isUnassigned ? 'sub_unassigned' : `sub_${subsystemId}`,
      kind: 'subsystem',
      name: subRow ? subRow.name_zh : '总装/未分类',
      name_en: subRow ? subRow.name_en : 'Final Assembly / Unassigned',
      sequence: subRow ? subRow.sequence : 99,
      level: 2,
      subsystem_id: subRow ? subRow.id : null,
      child_count: children.length,
      op_count: nodes.length,
    },
    children,
    breadcrumb: [
      { part_id: ROOT_ID, name: '总装', level: 1 },
      {
        part_id: isUnassigned ? 'sub_unassigned' : `sub_${subsystemId}`,
        name: subRow ? subRow.name_zh : '总装/未分类',
        level: 2,
      },
    ],
  }
}

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


module.exports = { getRootView, getSubsystemView, getPartView, getNodeView };
