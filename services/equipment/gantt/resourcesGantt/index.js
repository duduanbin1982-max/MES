"use strict";
// services/equipment/gantt/resourcesGantt/index.js
// 对外公共面：与原 services/equipment/gantt/resourcesGantt.js 的 { getResourcesGantt } 一致，
// 另附内部件便于测试与复用。

const time = require("./_time");
const items = require("./_items");
const { resolveWindow } = require("./_window");
const { loadSourceRows } = require("./_queries");
const { buildHeatmap } = require("./_heatmap");
const { buildInstanceBreakdown, buildWorkstationUtilization } = require("./_breakdown");
const { detectConflicts } = require("./_conflicts");
const { getResourcesGantt } = require("./gantt");

module.exports = {
  getResourcesGantt,
  resolveWindow,
  loadSourceRows,
  collectItems: items.collectItems,
  loadWorkstations: items.loadWorkstations,
  buildHeatmap,
  buildInstanceBreakdown,
  buildWorkstationUtilization,
  detectConflicts,
  normalizeItem: items.normalizeItem,
  overlapsWindow: items.overlapsWindow,
  workstationDailyCapacity: items.workstationDailyCapacity,
  time,
};
