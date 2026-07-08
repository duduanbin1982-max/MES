"use strict";
// services/processTree/mindmap/index.js
// 4 view 装配 + getMindmap 入口分发
// Author: 三狗子 | Date: 2026-06-24

const { ROOT_ID, isRoot, isSubsystem, isPart, isNode,
        subsystemIdOf, partBomIdOf, processNodeIdOf, assertValid } = require('../idCodec')
const { getRootView, getSubsystemView, getPartView, getNodeView } = require('./views')

function getMindmap(db, instanceId, partId) {
  assertValid(partId)
  partId = partId || ROOT_ID
  if (isRoot(partId))      return getRootView(db, instanceId)
  if (isSubsystem(partId)) return getSubsystemView(db, instanceId, subsystemIdOf(partId))
  if (isPart(partId))      return getPartView(db, instanceId, partBomIdOf(partId))
  if (isNode(partId))      return getNodeView(db, instanceId, processNodeIdOf(partId))
  throw new Error('unreachable')
}

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
  // 注意: getBreadcrumb 不在这里 re-export；调用方请直接使用 breadcrumb.js。
}