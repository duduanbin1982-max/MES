"use strict";
// services/processTree/mindmap.js
// mindmap 入口桥接：所有调用必须显式注入 db，避免服务层回退到全局 DB singleton。

const impl = require('./mindmap/index');

function requireDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('processTree mindmap requires db as the first argument');
  }
  return db;
}

function getMindmap(db, instanceId, partId) {
  return impl.getMindmap(requireDb(db), instanceId, partId);
}

function getRootView(db, instanceId) {
  return impl.getRootView(requireDb(db), instanceId);
}

function getSubsystemView(db, instanceId, subsystemId) {
  return impl.getSubsystemView(requireDb(db), instanceId, subsystemId);
}

function getPartView(db, instanceId, bomNodeId) {
  return impl.getPartView(requireDb(db), instanceId, bomNodeId);
}

function getNodeView(db, instanceId, nodeId) {
  return impl.getNodeView(requireDb(db), instanceId, nodeId);
}

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
};
