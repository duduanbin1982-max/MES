"use strict";
// services/processTree/breadcrumb.js
// 仅返回 mindmap 的 breadcrumb 段, 避免调一次整棵树
// Author: 三狗子 | Date: 2026-06-24

const { getMindmap } = require("./mindmap");

function getBreadcrumb(instanceId, partId) {
  return getMindmap(instanceId, partId).breadcrumb;
}

module.exports = { getBreadcrumb };
