"use strict";
// services/equipment/gantt/resourcesGantt/_breakdown.js
// 按整机拆分统计 + 工位利用率排行。
// (原 services/equipment/gantt/resourcesGantt.js 第 220-258 行)

function buildInstanceBreakdown(items) {
  const byInstance = {};
  for (const item of items) {
    const key = item.instance_id || "unassigned";
    if (!byInstance[key]) {
      byInstance[key] = {
        instance_id: item.instance_id,
        instance_code: item.instance_code || "N/A",
        instance_name: item.instance_name || "",
        item_count: 0,
        total_hours: 0,
        workstations: new Set(),
      };
    }
    byInstance[key].item_count += 1;
    byInstance[key].total_hours += item.hours;
    if (item.ws_id) byInstance[key].workstations.add(item.ws_id);
  }
  const instanceBreakdown = Object.values(byInstance).map((entry) => ({
    instance_id: entry.instance_id,
    instance_code: entry.instance_code,
    instance_name: entry.instance_name,
    item_count: entry.item_count,
    total_hours: Math.round(entry.total_hours * 10) / 10,
    workstation_count: entry.workstations.size,
    workstations: [...entry.workstations],
  }));

  return instanceBreakdown;
}

function buildWorkstationUtilization(heatmapGrid) {
  const workstationUtilization = heatmapGrid
    .map((heatmapRow) => ({
      ws_id: heatmapRow.ws_id,
      name: heatmapRow.name,
      workshop: heatmapRow.workshop,
      daily_capacity_hours: heatmapRow.daily_capacity_hours,
      total_busy_hours: heatmapRow.total_busy_hours,
      avg_utilization_pct: heatmapRow.avg_utilization_pct,
      peak_day: heatmapRow.cells.reduce((max, cell) => (cell.busy_hours > max.busy_hours ? cell : max), { day: "", busy_hours: 0, utilization_pct: 0 }),
      peak_utilization_pct: Math.max(0, ...heatmapRow.cells.map((cell) => cell.utilization_pct)),
    }))
    .sort((a, b) => b.avg_utilization_pct - a.avg_utilization_pct);

  return workstationUtilization;
}

module.exports = { buildInstanceBreakdown, buildWorkstationUtilization };
