"use strict";
// services/processTree/crossSubsystemDeps/loadSubsystems.js
// 加载某 instance 的 subsystems (含 unassigned 节点)
// Author: 三狗子 | Date: 2026-06-24

// 虚拟 subsystem id: 表示 "未分配到任何 subsystem 的节点"
const UNASSIGNED = "__unassigned__";

// Stable colour palette — 按 subsystem id 散列取色, 保证 UI 跨视图一致
const PALETTE = [
  "#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444",
  "#14b8a6", "#eab308", "#ec4899", "#6366f1", "#10b981",
];

// 根据 id 取色 (稳定散列)
function colorForId(id) {
  if (id == null) return "#94a3b8";
  return PALETTE[Math.abs(Number(id)) % PALETTE.length];
}

// 数字保留 2 位
function loadSubsystemsForInstance(db, instanceId) {
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
