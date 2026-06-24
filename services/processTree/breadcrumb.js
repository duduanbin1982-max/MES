"use strict";
// services/processTree/breadcrumb.js
// 仅返回 mindmap 的 breadcrumb 段, 避免调一次整棵树
// 改: 懒加载 mindmap, 避免循环依赖 (test 顺序: mindmap -> breadcrumb -> mindmap)
// Author: 三狗子 | Date: 2026-06-24

function getBreadcrumb(instanceId, partId) {
  const { getMindmap } = require('./mindmap/index');
  return getMindmap(instanceId, partId).breadcrumb;
}

module.exports = { getBreadcrumb };