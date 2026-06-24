"use strict";
// services/processTree/subsystems.js
// 子系统卡片视图 入口 (routes/instance.js 直接 require 这个)
// 实际实现拆到 ./subsystems/ 子目录
// Author: 三狗子 | Date: 2026-06-24

const { getSubsystems, SUBSYSTEM_COLORS } = require('./subsystems/subsystems');

module.exports = { getSubsystems, SUBSYSTEM_COLORS };