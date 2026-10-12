"use strict";
// 快模式按主题拆分（原 services/processTree/mindmap/views.js）
const { pickPartName, deriveStatus, statusFromChildren, ROOT_ID } = require('../_pure');

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

module.exports = { getRootView };
