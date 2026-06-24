"use strict";
// services/processTree/mindmap.js
// mindmap 入口 桥接 (routes/instance.js + tests 直接 require 这个)
// 实际实现拆到 ./mindmap/ 子目录
// 注意: require 写明 './mindmap/index', 不写 './mindmap' 避免解析成自己
// Author: 三狗子 | Date: 2026-06-24

const { getMindmap, getRootView, getSubsystemView, getPartView, getNodeView } = require('./mindmap/index');

module.exports = {
  getMindmap,
  getRootView,
  getSubsystemView,
  getPartView,
  getNodeView,
};