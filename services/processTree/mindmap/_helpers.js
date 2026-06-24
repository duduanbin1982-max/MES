"use strict";
// services/processTree/mindmap/_helpers.js
// 4 个 view 的纯函数工具 (无 DB 依赖, 易测)
// Author: 三狗子 | Date: 2026-06-24

const { ROOT_ID } = require('../idCodec');

/**
 * 名字回退链: material_name (最准) > operation_name (trim) > `零件 #id` 兜底
 * 出现 3 次: subsystem view (per-part), part view (整 part), node view (breadcrumb)
 */
function pickPartName(materialName, operationName, bomNodeId) {
  return materialName || extractPartName(operationName) || `零件 #${bomNodeId}`;
}

/**
 * operation_name 提取: trim 后非空才返回, 否则 null (交给 pickPartName 兜底)
 */
function extractPartName(operationName) {
  if (!operationName) return null;
  const trimmed = String(operationName).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 从计数算状态:
 *   total = 0        -> pending
 *   completed = total -> completed
 *   inProgress > 0   -> in_progress
 *   else              -> pending
 * 输入: { total, completed, inProgress }
 * 返回: { status, progress_pct }
 *
 * 出现 2 次: part view (per-part), aggregatePartsByBomId (sub-system view)
 */
function deriveStatus({ total = 0, completed = 0, inProgress = 0 } = {}) {
  let status;
  if (total === 0) status = 'pending';
  else if (completed === total) status = 'completed';
  else if (inProgress > 0) status = 'in_progress';
  else status = 'pending';
  const progress_pct = total === 0 ? 0 : Math.round((completed * 100) / total);
  return { status, progress_pct };
}

/**
 * 从 children 列表算 status (用于 part view 的 current 字段)
 * 输入: children [{status}, ...]
 * 输出: { status, progress_pct, completed, total }
 */
function statusFromChildren(children) {
  const total = children.length;
  let completed = 0, inProgress = 0;
  for (const c of children) {
    if (c.status === 'completed') completed++;
    else if (c.status === 'in_progress') inProgress++;
  }
  const { status, progress_pct } = deriveStatus({ total, completed, inProgress });
  return { status, progress_pct, completed, total };
}

/**
 * 把 process_nodes 列表按 bom_node_id 分组, 聚合成 part 列表
 * 每 part 含: bom_node_id / name / material_name / operation_count / completed / in_progress / progress_pct / status
 * 排序: 按 bom_node_id 升序
 * 出现 1 次: subsystem view (group by bom_node_id, 30 行)
 *
 * 输入 nodes 字段: id, operation_name, bom_node_id, material_name, status, ...
 */
function aggregatePartsByBomId(nodes) {
  const partMap = new Map();
  for (const n of nodes) {
    if (n.bom_node_id == null) continue;
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
      });
    }
    const p = partMap.get(n.bom_node_id);
    p.operation_count += 1;
    if (n.status === 'completed') p.completed += 1;
    else if (n.status === 'in_progress') p.in_progress += 1;
    if (false) p.any_critical = true;  // 保留位 (上游 critical-path 计算)
  }
  const parts = Array.from(partMap.values()).map((p) => {
    const { status, progress_pct } = deriveStatus({
      total: p.operation_count,
      completed: p.completed,
      inProgress: p.in_progress,
    });
    return { ...p, progress_pct, status };
  });
  parts.sort((a, b) => a.bom_node_id - b.bom_node_id);
  return parts;
}

module.exports = {
  pickPartName,
  extractPartName,
  deriveStatus,
  statusFromChildren,
  aggregatePartsByBomId,
  ROOT_ID,
};