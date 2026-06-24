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
// 拆分: 纯函数 (pickPartName / deriveStatus / statusFromChildren / aggregatePartsByBomId) 抽到
//       services/processTree/mindmap/_helpers.js, 方便单测
//       view 内的 DB 查询仍留本文件, 与 view 业务紧耦合
// 依赖: ../idCodec 编解码 partId
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
const { pickPartName, statusFromChildren, aggregatePartsByBomId } = require("./mindmap/_helpers");
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
      child_count: c.parts,
      op_count: c.ops,
      subsystem_id: s.id,
    });
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

  // 30 行 group-by 逻辑已抽到 _helpers
  const children = aggregatePartsByBomId(nodes);

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
  const partName = pickPartName(first.material_name, first.operation_name, bomNodeId);
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

  // status/progress_pct 已抽到 _helpers.statusFromChildren
  const { status, progress_pct } = statusFromChildren(children);

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
  };
}

function getNodeView(instanceId, nodeId) {
  const row = db
    .prepare(
      `SELECT n.id, n.operation_name, n.bom_node_id, n.sequence, m.material_name,
              n.status, n.estimated_hours, n.assigned_to, n.required_workstation_id,
              n.subsystem_id, n.notes, n.planned_start, n.planned_end,
              n.actual_start, n.actual_end
         FROM process_nodes n
         LEFT JOIN instance_bom b ON b.id = n.bom_node_id AND b.equipment_instance_id = n.equipment_instance_id
         LEFT JOIN materials m ON m.id = b.material_id
        WHERE n.id = ? AND n.equipment_instance_id = ?`
    )
    .get(nodeId, instanceId);

  if (!row) {
    throw Object.assign(new Error(`node ${nodeId} not found in instance ${instanceId}`), { status: 404 });
  }

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

  const childEdges = outgoing.map((e) => ({
    kind: 'edge',
    edge_kind: 'outgoing',
    part_id: `node_${e.to_id}`,
    name: e.to_name,
    status: e.to_status,
    dep_type: e.dep_type,
  }));

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
    const partName = pickPartName(row.material_name, row.operation_name, row.bom_node_id);
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
// Public API
// ---------------------------------------------------------------------------

function getMindmap(instanceId, partId) {
  assertValid(partId);
  partId = partId || ROOT_ID;
  if (isRoot(partId))      return getRootView(instanceId);
  if (isSubsystem(partId)) return getSubsystemView(instanceId, subsystemIdOf(partId));
  if (isPart(partId))      return getPartView(instanceId, partBomIdOf(partId));
  if (isNode(partId))      return getNodeView(instanceId, processNodeIdOf(partId));
  throw new Error("unreachable");
}

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
  // 注意: getBreadcrumb 不在这里 re-export, 避免与 breadcrumb.js 循环依赖
  // 调用方请直接 require("../breadcrumb") 拿 getBreadcrumb
};