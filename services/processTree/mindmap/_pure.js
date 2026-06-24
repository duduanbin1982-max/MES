"use strict";
// services/processTree/mindmap/_pure.js
// 纯函数工具 (无 DB 依赖, 易测) - 跨 4 个 view 共享
//   pickPartName / extractPartName / deriveStatus / statusFromChildren
//   aggregatePartsByBomId 是 subsystem view 专属, 留在 views/subsystem.js
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

module.exports = {
  pickPartName,
  extractPartName,
  deriveStatus,
  statusFromChildren,
  ROOT_ID,
};