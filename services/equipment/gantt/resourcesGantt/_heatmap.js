"use strict";
// services/equipment/gantt/resourcesGantt/_heatmap.js
// 工位日热力图 + 网格。
// (原 services/equipment/gantt/resourcesGantt.js 第 172-218 行)

const { MS_PER_HOUR, formatDate, addDays } = require("./_time");

function buildHeatmap(workstations, items, rangeStart, numDays) {
  const workstationById = new Map(workstations.map((workstation) => [Number(workstation.id), workstation]));
  const dayList = [];
  for (let offset = 0; offset < numDays; offset++) dayList.push(formatDate(addDays(rangeStart, offset)));

  const heatmap = {};
  for (const workstation of workstations) {
    heatmap[workstation.id] = { ws_id: workstation.id, name: workstation.name, daily_capacity_hours: workstation.daily_capacity_hours, by_day: {} };
  }

  for (const item of items) {
    if (!item.ws_id || !heatmap[item.ws_id]) continue;
    const durationMs = Math.max(MS_PER_HOUR / 4, item._end.getTime() - item._start.getTime());
    for (let offset = 0; offset < numDays; offset++) {
      const dayStart = addDays(rangeStart, offset);
      const dayEnd = addDays(dayStart, 1);
      const overlapMs = Math.max(0, Math.min(item._end.getTime(), dayEnd.getTime()) - Math.max(item._start.getTime(), dayStart.getTime()));
      if (overlapMs <= 0) continue;
      const busyHours = item.hours * (overlapMs / durationMs);
      const day = formatDate(dayStart);
      heatmap[item.ws_id].by_day[day] = (heatmap[item.ws_id].by_day[day] || 0) + busyHours;
    }
  }

  const heatmapGrid = workstations.map((workstation) => {
    const dailyCapacity = workstation.daily_capacity_hours;
    const cells = dayList.map((day) => {
      const busy = heatmap[workstation.id].by_day[day] || 0;
      const utilization = Math.round((busy / dailyCapacity) * 100);
      return {
        day,
        busy_hours: Math.round(busy * 10) / 10,
        capacity_hours: dailyCapacity,
        utilization_pct: utilization,
        level: utilization >= 100 ? "overload" : utilization >= 80 ? "busy" : utilization >= 30 ? "normal" : "idle",
      };
    });
    const busyHours = cells.reduce((sum, cell) => sum + cell.busy_hours, 0);
    return {
      ws_id: workstation.id,
      name: workstation.name,
      workshop: workstation.workshop,
      daily_capacity_hours: dailyCapacity,
      total_busy_hours: Math.round(busyHours * 10) / 10,
      avg_utilization_pct: Math.round((busyHours / (numDays * dailyCapacity)) * 100),
      cells,
    };
  });

  return { workstationById, dayList, heatmapGrid };
}

module.exports = { buildHeatmap };
