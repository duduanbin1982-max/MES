"use strict";
// services/processTree/mindmap.js
// Process-tree 4-level mindmap 主逻辑
//
// 4 个 view:
//   getRootView        - 总装根: 列出所有主部件 (subsystems)
//   getSubsystemView   - 主部件: 列出该 subsystem 下的零件
//   getPartView        - 零件: 列出该 bom_node 下的工序
//   getNodeView        - 工序: 列出子节点 (如果有)
//
// 主入口: getMindmap(instanceId, partId) - 根据 partId 路由到 4 个 view 之一
//
// 依赖: idCodec.js 编解码 partId
// Author: 三狗子 | Date: 2026-06-24

const db = require("../../db");
const {
  ROOT_ID,
  isRoot,
  isSubsystem,
  isPart,
  isNode,
  subsystemIdOf,
  partBomIdOf,
  processNodeIdOf,
  assertValid,
} = require("./idCodec");
// ---------------------------------------------------------------------------

function getRootView(instanceId) {
  // Single synthetic root.
  const totalNodes = db
    .prepare(
      `SELECT COUNT(*) AS c FROM process_nodes WHERE equipment_instance_id = ?`
    )
    .get(instanceId).c;
  const completed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM process_nodes
        WHERE equipment_instance_id = ? AND status = 'completed'`
    )
    .get(instanceId).c;
  const inProgress = db
    .prepare(
      `SELECT COUNT(*) AS c FROM process_nodes
        WHERE equipment_instance_id = ? AND status = 'in_progress'`
    )
    .get(instanceId).c;
  const subsystems = db
    .prepare(
      `SELECT id, code, name_zh, name_en, sequence
         FROM equipment_subsystems
         ORDER BY sequence ASC, id ASC`
    )
    .all();

  // Critical-path membership is computed upstream (processTreeGenerator).
  // For now mark critical_count via subsystem by joining the critical set
  // (we keep this light — only counts of children).
  const childCounts = db
    .prepare(
      `SELECT subsystem_id, COUNT(DISTINCT bom_node_id) AS parts,
              COUNT(*) AS ops
         FROM process_nodes
        WHERE equipment_instance_id = ?
        GROUP BY subsystem_id`
    )
    .all(instanceId);

  const unassigned = db
    .prepare(
      `SELECT COUNT(DISTINCT bom_node_id) AS parts, COUNT(*) AS ops
         FROM process_nodes
        WHERE equipment_instance_id = ? AND subsystem_id IS NULL`
    )
    .get(instanceId);

  const children = [];
  for (const s of subsystems) {
    const c = childCounts.find((x) => x.subsystem_id === s.id) || { parts: 0, ops: 0 };
    children.push({
      part_id: `sub_${s.id}`,
      kind: 'subsystem',
      name: s.name_zh,
      name_en: s.name_en,
      sequence: s.sequence,
      level: 2,
      child_count: c.parts, // distinct parts underneath
      op_count: c.ops,
      subsystem_id: s.id,
    });
  }
  // Surface unassigned group as a child of root if any nodes lack subsystem.
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
    });
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
  };
}

function getSubsystemView(instanceId, subsystemId) {
  // subsystemId may be a real int or NaN (the synthetic 'sub_unassigned' id).
  const isUnassigned = !Number.isFinite(subsystemId);
  const subRow = isUnassigned
    ? null
    : db
        .prepare(
          `SELECT id, code, name_zh, name_en, sequence
             FROM equipment_subsystems WHERE id = ?`
        )
        .get(subsystemId);
  if (!isUnassigned && !subRow) {
    throw Object.assign(new Error(`subsystem ${subsystemId} not found`), { status: 404 });
  }

  const nodes = db
    .prepare(
      `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
              n.status, n.estimated_hours, 0 AS is_critical
         FROM process_nodes n
         LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
         LEFT JOIN materials m ON m.id = b.material_id
        WHERE n.equipment_instance_id = ?
          ${isUnassigned ? 'AND n.subsystem_id IS NULL' : 'AND n.subsystem_id = ?'}
        ORDER BY n.bom_node_id, n.sequence`
    )
    .all(isUnassigned ? instanceId : [instanceId, subsystemId]);

  // Group nodes by bom_node_id → distinct parts.
  const partMap = new Map();
  for (const n of nodes) {
    if (n.bom_node_id == null) continue;
    if (!partMap.has(n.bom_node_id)) {
      partMap.set(n.bom_node_id, {
        part_id: `part_${n.bom_node_id}`,
        kind: 'part',
        level: 3,
        bom_node_id: n.bom_node_id,
        name: n.material_name || extractPartName(n.operation_name) || `零件 #${n.bom_node_id}`,
        material_name: n.material_name || null,
        operation_count: 0,
        completed: 0,
        in_progress: 0,
        any_critical: false,
      });
    }
    const p = partMap.get(n.bom_node_id);
    p.operation_count += 1;
    if (n.status === 'completed') p.completed += 1;
    else if (n.status === 'in_progress') p.in_progress += 1;
    if (false) p.any_critical = true;
  }

  const children = Array.from(partMap.values()).map((p) => ({
    ...p,
    progress_pct: p.operation_count === 0 ? 0 : Math.round((p.completed * 100) / p.operation_count),
    status:
      p.completed === p.operation_count
        ? 'completed'
        : p.in_progress > 0
          ? 'in_progress'
          : 'pending',
  }));

  // Sort by bom_node_id so children order is stable.
  children.sort((a, b) => a.bom_node_id - b.bom_node_id);

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
  };
}

function getPartView(instanceId, bomNodeId) {
  // Level 3: distinct part → show its operations (level 4).
  const rows = db
    .prepare(
      `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
              n.status, n.estimated_hours, 0 AS is_critical, n.subsystem_id,
              n.assigned_to, n.required_workstation_id
         FROM process_nodes n
         LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
         LEFT JOIN materials m ON m.id = b.material_id
        WHERE n.equipment_instance_id = ? AND n.bom_node_id = ?
        ORDER BY n.sequence, n.id`
    )
    .all(instanceId, bomNodeId);

  if (rows.length === 0) {
    throw Object.assign(new Error(`part bom_node_id=${bomNodeId} not found in instance ${instanceId}`), { status: 404 });
  }

  const first = rows[0];
  const partName = first.material_name || extractPartName(first.operation_name) || `零件 #${bomNodeId}`;
  const subsystemId = first.subsystem_id;

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
  }));

  // Breadcrumb: root → subsystem → part
  const breadcrumb = [{ part_id: ROOT_ID, name: '总装', level: 1 }];
  if (subsystemId != null) {
    const sub = db
      .prepare(`SELECT name_zh FROM equipment_subsystems WHERE id = ?`)
      .get(subsystemId);
    breadcrumb.push({
      part_id: `sub_${subsystemId}`,
      name: sub ? sub.name_zh : `subsystem ${subsystemId}`,
      level: 2,
    });
  } else {
    breadcrumb.push({ part_id: 'sub_unassigned', name: '总装/未分类', level: 2 });
  }
  breadcrumb.push({ part_id: `part_${bomNodeId}`, name: partName, level: 3 });

  const completed = children.filter((c) => c.status === 'completed').length;

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
      progress_pct: children.length === 0 ? 0 : Math.round((completed * 100) / children.length),
      status:
        completed === children.length
          ? 'completed'
          : children.some((c) => c.status === 'in_progress')
            ? 'in_progress'
            : 'pending',
    },
    children,
    breadcrumb,
  };
}

function getNodeView(instanceId, nodeId) {
  // Level 4 (leaf): a single operation. Show its dependencies as "edges out".
  const row = db
    .prepare(
      `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
              n.status, n.estimated_hours, 0 AS is_critical, n.subsystem_id,
              n.assigned_to, n.required_workstation_id,
              n.notes, n.planned_start, n.planned_end, n.actual_start, n.actual_end
         FROM process_nodes n
         LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
         LEFT JOIN materials m ON m.id = b.material_id
        WHERE n.id = ? AND n.equipment_instance_id = ?`
    )
    .get(nodeId, instanceId);
  if (!row) {
    throw Object.assign(new Error(`process_node ${nodeId} not found in instance ${instanceId}`), { status: 404 });
  }

  // Outgoing dependencies (this node precedes X) and incoming (Y precedes this).
  const outgoing = db
    .prepare(
      `SELECT d.successor_id AS to_id, d.dep_type, n.operation_name AS to_name, n.status AS to_status
         FROM process_dependencies d
         JOIN process_nodes n ON n.id = d.successor_id
        WHERE d.predecessor_id = ?`
    )
    .all(nodeId);
  const incoming = db
    .prepare(
      `SELECT d.predecessor_id AS from_id, d.dep_type, n.operation_name AS from_name, n.status AS from_status
         FROM process_dependencies d
         JOIN process_nodes n ON n.id = d.predecessor_id
        WHERE d.successor_id = ?`
    )
    .all(nodeId);

  // No children — show dependencies as "edges" so the mindmap still has
  // something to render around the centre node.
  const childEdges = outgoing.map((e) => ({
    kind: 'edge',
    edge_kind: 'outgoing',
    part_id: `node_${e.to_id}`,
    name: e.to_name,
    status: e.to_status,
    dep_type: e.dep_type,
  }));

  // Breadcrumb up to part level.
  const breadcrumb = [{ part_id: ROOT_ID, name: '总装', level: 1 }];
  if (row.subsystem_id != null) {
    const sub = db
      .prepare(`SELECT name_zh FROM equipment_subsystems WHERE id = ?`)
      .get(row.subsystem_id);
    breadcrumb.push({
      part_id: `sub_${row.subsystem_id}`,
      name: sub ? sub.name_zh : `subsystem ${row.subsystem_id}`,
      level: 2,
    });
  } else {
    breadcrumb.push({ part_id: 'sub_unassigned', name: '总装/未分类', level: 2 });
  }
  if (row.bom_node_id != null) {
    const partName = row.material_name || extractPartName(row.operation_name) || `零件 #${row.bom_node_id}`;
    breadcrumb.push({ part_id: `part_${row.bom_node_id}`, name: partName, level: 3 });
  }
  breadcrumb.push({ part_id: `node_${nodeId}`, name: row.operation_name, level: 4 });

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
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Some operation_names double as part descriptors when the BOM doesn't
 * carry a material_name (typical for the demo dataset). Falls back to a
 * trimmed version of the operation name.
 */
function extractPartName(operationName) {
  if (!operationName) return null;
  const trimmed = String(operationName).trim();
  return trimmed.length > 0 ? trimmed : null;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getMindmap(instanceId, partId) {
  assertValid(partId);
  partId = partId || ROOT_ID;
  if (isRoot(partId))      return getRootView(instanceId);
  if (isSubsystem(partId)) return getSubsystemView(instanceId, subsystemIdOf(partId));
  if (isPart(partId))      return getPartView(instanceId, partBomIdOf(partId));
  if (isNode(partId))      return getNodeView(instanceId, processNodeIdOf(partId));
  // assertValid 已经抛 400, 不会到这
  throw new Error("unreachable");
}

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
  extractPartName,
  // 注意: getBreadcrumb 不在这里 re-export, 避免与 breadcrumb.js 循环依赖
  // 调用方请直接 require("./breadcrumb") 拿 getBreadcrumb
};
