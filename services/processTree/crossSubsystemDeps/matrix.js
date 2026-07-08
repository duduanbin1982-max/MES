"use strict";
// services/processTree/crossSubsystemDeps/matrix.js
// getCrossSubsystemMatrix 主函数: 计算 N×N 矩阵 + strongest/weakest/bottlenecks
// Author: 三狗子 | Date: 2026-06-24

// Inline (brooks-debt R4)
const TYPE_FACTOR = {
  FS: 1.0,  // Finish-to-Start: 完成-开始
  SS: 0.7,  // Start-to-Start: 同时开始
  FF: 0.5,  // Finish-to-Finish: 同时完成
  SF: 0.5,  // Start-to-Finish: 开始-完成 (少用)
};

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
function round2(n) { return Math.round(n * 100) / 100; }
const { loadSubsystemsForInstance } = require('./loadSubsystems');
function getCrossSubsystemMatrix(db, instanceId) {
  const subsystems = loadSubsystemsForInstance(db, instanceId);
  const subKeys = subsystems.map((s) => s.key);

  // Flat-lookup helpers.
  const keyIndex = new Map();
  subKeys.forEach((k, i) => keyIndex.set(k, i));

  // Per-subsystem node counts (for weighting).
  const nodeCounts = new Map();
  subsystems.forEach((s) => nodeCounts.set(s.key, s.node_count));

  // Initialise matrix.
  const matrix = subKeys.map((row) =>
    subKeys.map((col) => ({ count: 0, weight: 0, edges: [] }))
  );

  // Pull every node in this instance with its subsystem key (or UNASSIGNED).
  const nodeRows = db
    .prepare(
      `SELECT id, subsystem_id FROM process_nodes WHERE equipment_instance_id = ?`
    )
    .all(instanceId);
  const nodeToSub = new Map();
  for (const r of nodeRows) {
    nodeToSub.set(r.id, r.subsystem_id == null ? UNASSIGNED : `sub_${r.subsystem_id}`);
  }

  // Pull every dep edge for nodes in this instance.
  // Real .73 schema: process_dependencies(predecessor_id, successor_id, dep_type).
  // An edge contributes iff BOTH endpoints are in this instance.
  const depRows = db
    .prepare(
      `SELECT d.predecessor_id AS from_id, d.successor_id AS to_id, d.dep_type AS type
       FROM process_dependencies d
       JOIN process_nodes n_pre ON n_pre.id = d.predecessor_id
       JOIN process_nodes n_suc  ON n_suc.id  = d.successor_id
       WHERE n_pre.equipment_instance_id = ?
         AND n_suc.equipment_instance_id  = ?`
    )
    .all(instanceId, instanceId);

  let totalEdges = 0;
  let interEdges = 0;
  let intraEdges = 0;
  const interWeights = []; // {from,to,weight}
  const edgeTotals = new Map(); // "i->j" -> weight (for coupling ranking)

  for (const e of depRows) {
    const fromKey = nodeToSub.get(e.from_id);
    const toKey = nodeToSub.get(e.to_id);
    if (fromKey == null || toKey == null) continue; // node in another instance, skip

    const fromCount = nodeCounts.get(fromKey) || 0;
    const toCount = nodeCounts.get(toKey) || 0;
    if (fromCount === 0 || toCount === 0) continue;

    const factor = TYPE_FACTOR[(e.type || 'FS').toUpperCase()] ?? 1.0;
    // Weight = product of node counts × dependency factor.
    // Using a *product* (rather than sum) captures "how many ordered pairs
    // of nodes cross this boundary" — a meaningful coupling proxy.
    const weight = fromCount * toCount * factor;

    const i = keyIndex.get(fromKey);
    const j = keyIndex.get(toKey);
    if (i == null || j == null) continue;

    matrix[i][j].count += 1;
    matrix[i][j].weight += weight;
    matrix[i][j].edges.push({ from: e.from_id, to: e.to_id, type: e.type || 'FS' });

    totalEdges += 1;
    if (i === j) intraEdges += 1;
    else {
      interEdges += 1;
      interWeights.push({ from: fromKey, to: toKey, weight });
      edgeTotals.set(`${i}->${j}`, (edgeTotals.get(`${i}->${j}`) || 0) + weight);
    }
  }

  // Strongest inter-subsystem couplings (top 3 off-diagonal).
  const strongest = Array.from(edgeTotals.entries())
    .map(([k, w]) => {
      const [i, j] = k.split('->').map(Number);
      return {
        from: subKeys[i],
        to: subKeys[j],
        weight: round2(w),
      };
    })
    .filter((p) => p.from !== p.to)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // Weakest inter-subsystem couplings (pairs with NO edges but both have nodes).
  const weakest = [];
  for (let i = 0; i < subKeys.length; i += 1) {
    if (subKeys[i] === UNASSIGNED) continue;
    for (let j = 0; j < subKeys.length; j += 1) {
      if (i === j) continue;
      if (subKeys[j] === UNASSIGNED) continue;
      if ((nodeCounts.get(subKeys[i]) || 0) === 0) continue;
      if ((nodeCounts.get(subKeys[j]) || 0) === 0) continue;
      if (edgeTotals.has(`${i}->${j}`)) continue;
      weakest.push({
        from: subKeys[i],
        to: subKeys[j],
        weight: 0,
        both_have_nodes: true,
      });
    }
  }
  // Cap to bottom 3 (or all if fewer).
  weakest.sort((a, b) => a.weight - b.weight);
  const weakestCapped = weakest.slice(0, 3);

  // Integration bottlenecks = subsystems ranked by (in + out) inter-subsystem weight.
  const bottlenecks = subKeys.map((k, i) => {
    let inW = 0;
    let outW = 0;
    for (let j = 0; j < subKeys.length; j += 1) {
      if (i === j) continue;
      if (subKeys[j] === UNASSIGNED) continue;
      if (subKeys[i] === UNASSIGNED) continue;
      inW += matrix[j][i].weight;
      outW += matrix[i][j].weight;
    }
    return {
      subsystem: k,
      in_weight: round2(inW),
      out_weight: round2(outW),
      total: round2(inW + outW),
    };
  })
    .filter((b) => b.subsystem !== UNASSIGNED)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  return {
    instance_id: instanceId,
    subsystems: subsystems.map((s) => ({
      key: s.key,
      name: s.name,
      name_en: s.name_en,
      color: s.color,
      node_count: s.node_count,
    })),
    matrix: matrix.map((row) =>
      row.map((cell) => ({
        count: cell.count,
        weight: round2(cell.weight),
        edges: cell.edges,
      }))
    ),
    summary: {
      total_edges: totalEdges,
      inter_subsystem_edges: interEdges,
      intra_subsystem_edges: intraEdges,
      strongest_coupling: strongest,
      weakest_coupling: weakestCapped,
      integration_bottlenecks: bottlenecks,
    },
  };
}

module.exports = { getCrossSubsystemMatrix };
