"use strict";
// services/processTree/mindmap/index.js
// 4 view 装配 + getMindmap 入口分发
// Author: 三狗子 | Date: 2026-06-24

const { ROOT_ID, isRoot, isSubsystem, isPart, isNode,
        subsystemIdOf, partBomIdOf, processNodeIdOf, assertValid } = require('../idCodec')
const { getRootView } = require('./views/root')
const { getSubsystemView } = require('./views/subsystem')
const { getPartView } = require('./views/part')
const { getNodeView } = require('./views/node')

function getMindmap(instanceId, partId) {
  assertValid(partId)
  partId = partId || ROOT_ID
  if (isRoot(partId))      return getRootView(instanceId)
  if (isSubsystem(partId)) return getSubsystemView(instanceId, subsystemIdOf(partId))
  if (isPart(partId))      return getPartView(instanceId, partBomIdOf(partId))
  if (isNode(partId))      return getNodeView(instanceId, processNodeIdOf(partId))
  throw new Error('unreachable')
}

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
  // 注意: getBreadcrumb 不在这里 re-export, 避免与 breadcrumb.js 循环依赖
  // 调用方请直接 require('../breadcrumb') 拿 getBreadcrumb
}