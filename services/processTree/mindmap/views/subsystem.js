"use strict";
// services/processTree/mindmap/views/subsystem.js
// 主部件视图: 列出该 subsystem 下的零件 (按 bom_node_id 聚合)
//   聚合函数 aggregatePartsByBomId 是本 view 专属, 留这里不外提
// Author: 三狗子 | Date: 2026-06-24

const db = require('../../../../db');
const { pickPartName, deriveStatus, ROOT_ID } = require('../_pure')

// 把 process_nodes 按 bom_node_id 分组聚合成 part 列表
// 输入 nodes 字段: id, operation_name, bom_node_id, material_name, status, ...
function aggregatePartsByBomId(nodes) {
  const partMap = new Map()
  for (const n of nodes) {
    if (n.bom_node_id == null) continue
    if (!partMap.has(n.bom_node_id)) {
      partMap.set(n.bom_node_id, {
        part_id: `part_${n.bom_node_id}`,
        kind: 'part',
        level: 3,
        bom_node_id: n.bom_node_id,
        name: pickPartName(n.material_name, n.operation_name, n.bom_node_id),
        material_name: n.material_name || null,
        operation_count: 0,
        completed: 0,
        in_progress: 0,
        any_critical: false,
      })
    }
    const p = partMap.get(n.bom_node_id)
    p.operation_count += 1
    if (n.status === 'completed') p.completed += 1
    else if (n.status === 'in_progress') p.in_progress += 1
  }
  const parts = Array.from(partMap.values()).map((p) => {
    const { status, progress_pct } = deriveStatus({
      total: p.operation_count,
      completed: p.completed,
      inProgress: p.in_progress,
    })
    return { ...p, progress_pct, status }
  })
  parts.sort((a, b) => a.bom_node_id - b.bom_node_id)
  return parts
}

function getSubsystemView(instanceId, subsystemId) {
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

module.exports = { getSubsystemView }