"use strict";
// 快模式按主题拆分（原 services/processTree/mindmap/views.js）
const { pickPartName, statusFromChildren, ROOT_ID } = require('../_pure');

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

module.exports = { aggregatePartsByBomId, getSubsystemView };
