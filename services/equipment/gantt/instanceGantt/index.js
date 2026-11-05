"use strict";
// services/equipment/gantt/instanceGantt/index.js
// 对外公共面：与原 services/equipment/gantt/instanceGantt.js 的 { getInstanceGantt } 一致，
// 另附内部件便于测试。
//
// services/equipment/gantt.js 里的 require("./gantt/instanceGantt") 无需改动 ——
// 删掉同名 .js 后 Node 会解析到本目录的 index.js。

const time = require("./_time");
const { nodeWorkHours, buildFallbackScheduler } = require("./_scheduler");
const { getInstanceGantt } = require("./gantt");
const { getInstanceAlerts } = require("./alerts");

module.exports = {
  getInstanceGantt,
  getInstanceAlerts,
  nodeWorkHours,
  buildFallbackScheduler,
  time,
};
