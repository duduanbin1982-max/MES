"use strict";
// services/processTree/crossSubsystemDeps/loadSubsystems.js
// 加载某 instance 的 subsystems (含 unassigned 节点)
// Author: 三狗子 | Date: 2026-06-24

const db = require('../../../db');
const { UNASSIGNED, colorForId } = require('./constants');
function loadSubsystemsForInstance(instanceId) {
  // Subsystems with at least one node in this instance.
  // Real .73 schema: equipment_subsystems(id, code, name_zh, name_en, sequence, description, equipment_type_id).
  // No `name` or `color` columns — we synthesise display names from name_zh
  // and derive colours from a stable hash of `id` so the UI stays consistent.
  const rows = db
    .prepare(
      `SELECT s.id, s.code, s.name_zh AS name, s.name_en, s.sequence,
              COUNT(n.id) AS node_count
         FROM equipment_subsystems s
         JOIN process_nodes n ON n.subsystem_id = s.id
        WHERE n.equipment_instance_id = ?
        GROUP BY s.id
        ORDER BY s.sequence ASC, s.id ASC`
    )
    .all(instanceId);

  const list = rows.map((r) => ({
    id: r.id,
    key: `sub_${r.id}`,
    name: r.name || r.code || `subsystem ${r.id}`,
    name_en: r.name_en || null,
    color: colorForId(r.id),
    node_count: r.node_count,
  }));

  // Also check for nodes without subsystem_id (总装/未分类).
  const unassigned = db
    .prepare(
      `SELECT COUNT(*) AS c FROM process_nodes
        WHERE equipment_instance_id = ? AND subsystem_id IS NULL`
    )
    .get(instanceId);
  if (unassigned.c > 0) {
    list.push({
      id: null,
      key: UNASSIGNED,
      name: '总装/未分类',
      name_en: 'Final Assembly / Unassigned',
      color: '#94a3b8',
      node_count: unassigned.c,
    });
  }

  return list;
}

module.exports = { loadSubsystemsForInstance };
