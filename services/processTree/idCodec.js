"use strict";
// services/processTree/idCodec.js
// 4-level 树 part_id 编解码工具
// 格式:
//   "root"                 -> level 1 (总装根, 虚拟)
//   "sub_<n>"              -> level 2 (主部件, equipment_subsystems.id)
//   "part_<n>"             -> level 3 (零件, bom_node_id)
//   "node_<n>"             -> level 4 (工序, process_nodes.id)
//
// 原文件 slice(4)/slice(5) 隐含 prefix 长度, 改为显式常量, 防止改 prefix 字符串时改错
// Author: 三狗子 | Date: 2026-06-24

const ROOT_ID = "root";
const SUB_PREFIX = "sub_";
const PART_PREFIX = "part_";
const NODE_PREFIX = "node_";

function isRoot(id) {
  return id === ROOT_ID || id == null;
}
function isSubsystem(id) {
  return typeof id === "string" && id.startsWith(SUB_PREFIX);
}
function isPart(id) {
  return typeof id === "string" && id.startsWith(PART_PREFIX);
}
function isNode(id) {
  return typeof id === "string" && id.startsWith(NODE_PREFIX);
}
function subsystemIdOf(partId) {
  return parseInt(partId.slice(SUB_PREFIX.length), 10);
}
function partBomIdOf(partId) {
  return parseInt(partId.slice(PART_PREFIX.length), 10);
}
function processNodeIdOf(partId) {
  return parseInt(partId.slice(NODE_PREFIX.length), 10);
}

// 校验 part_id 是否合法 (用于 400 错误)
function assertValid(partId) {
  if (isRoot(partId)) return;
  let n = NaN;
  if (isSubsystem(partId)) n = subsystemIdOf(partId);
  else if (isPart(partId)) n = partBomIdOf(partId);
  else if (isNode(partId)) n = processNodeIdOf(partId);
  if (Number.isFinite(n) && n > 0) return;
  const err = new Error("invalid part_id: " + partId);
  err.status = 400;
  throw err;
}

module.exports = {
  ROOT_ID,
  SUB_PREFIX,
  PART_PREFIX,
  NODE_PREFIX,
  isRoot,
  isSubsystem,
  isPart,
  isNode,
  subsystemIdOf,
  partBomIdOf,
  processNodeIdOf,
  assertValid,
};
