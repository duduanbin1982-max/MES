"use strict";
// services/processTree/crossSubsystemDeps.js
// 跨子系统依赖矩阵入口：所有调用必须显式注入 db，避免服务层回退到全局 DB singleton。

const { getCrossSubsystemMatrix: buildCrossSubsystemMatrix } = require('./crossSubsystemDeps/matrix');
const { loadSubsystemsForInstance: loadSubsystems } = require('./crossSubsystemDeps/loadSubsystems');

const TYPE_FACTOR = {
  FS: 1.0,
  SS: 0.7,
  FF: 0.5,
  SF: 0.5,
};

const UNASSIGNED = "__unassigned__";

function requireDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('processTree crossSubsystemDeps requires db as the first argument');
  }
  return db;
}

function getCrossSubsystemMatrix(db, instanceId) {
  return buildCrossSubsystemMatrix(requireDb(db), instanceId);
}

function loadSubsystemsForInstance(db, instanceId) {
  return loadSubsystems(requireDb(db), instanceId);
}

module.exports = {
  getCrossSubsystemMatrix,
  loadSubsystemsForInstance,
  TYPE_FACTOR,
  UNASSIGNED,
};
