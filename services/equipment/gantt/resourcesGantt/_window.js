"use strict";
// services/equipment/gantt/resourcesGantt/_window.js
// 解析查询参数 -> 时间窗口。(原 services/equipment/gantt/resourcesGantt.js 第 87-93 行)

const { parseDate, addDays } = require("./_time");

function resolveWindow(query) {
  const { start_date, days, instance_id, compare } = query || {};
  const rangeStart = parseDate(start_date || new Date().toISOString().slice(0, 10)) || new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const numDays = Math.min(180, Math.max(1, Number.parseInt(days, 10) || 30));
  const rangeEnd = addDays(rangeStart, numDays);
  const instanceFilter = instance_id ? Number.parseInt(instance_id, 10) : null;

  return { rangeStart, numDays, rangeEnd, instanceFilter, compare };
}

module.exports = { resolveWindow };
