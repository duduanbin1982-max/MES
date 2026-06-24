"use strict";
// services/equipment/gantt.js
// 甘特图端点入口 (server.js 直接 require 这个)
// 实际实现拆到 ./gantt/ 子目录
// Author: 三狗子 | Date: 2026-06-24

const { getInstanceGantt } = require("./gantt/instanceGantt");
const { getResourcesGantt } = require("./gantt/resourcesGantt");

module.exports = {
  getInstanceGantt,
  getResourcesGantt,
};
