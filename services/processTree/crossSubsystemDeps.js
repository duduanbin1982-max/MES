"use strict";
// services/processTree/crossSubsystemDeps.js
// 跨子系统依赖矩阵 入口 (server.js 直接 require 这个)
// 实际实现拆到 ./crossSubsystemDeps/ 子目录
// Author: 三狗子 | Date: 2026-06-24

const { getCrossSubsystemMatrix } = require('./crossSubsystemDeps/matrix');
const { loadSubsystemsForInstance } = require('./crossSubsystemDeps/loadSubsystems');
const { TYPE_FACTOR, UNASSIGNED } = require('./crossSubsystemDeps/constants');

module.exports = {
  getCrossSubsystemMatrix,
  loadSubsystemsForInstance,
  TYPE_FACTOR,
  UNASSIGNED,
};
