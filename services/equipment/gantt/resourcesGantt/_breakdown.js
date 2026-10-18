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

/**
 * P2-1（2026-10-19）：挑出"最紧的三个工位"和"最空闲的三个工位"。
 * 排序依据：峰值利用率（peak_utilization_pct）→ 平均利用率（avg_utilization_pct）→ 已用工时倒序。
 * @param {Array} utilization buildWorkstationUtilization 的输出
 * @param {number} n 取前几个（默认 3）
 * @returns {{top_overloaded: Array, top_idle: Array, threshold: {overload_pct: number, idle_pct: number}}}
 */
function pickBottlenecks(utilization, n = 3) {
  const list = (utilization || []).filter((row) => row && row.daily_capacity_hours > 0);
  const score = (row) => [
    Number(row.peak_utilization_pct || 0),
    Number(row.avg_utilization_pct || 0),
    Number(row.total_busy_hours || 0),
  ];
  const compare = (a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sb[i] !== sa[i]) return sb[i] - sa[i];
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  };
  const sorted = [...list].sort(compare);
  const brief = (row) => ({
    ws_id: row.ws_id,
    name: row.name,
    workshop: row.workshop,
    avg_utilization_pct: row.avg_utilization_pct,
    peak_utilization_pct: row.peak_utilization_pct,
    peak_day: row.peak_day,
    total_busy_hours: row.total_busy_hours,
    daily_capacity_hours: row.daily_capacity_hours,
  });
  return {
    top_overloaded: sorted.slice(0, n).map(brief),
    // 空闲：从最不忙的一端取，但只取"确实空闲"（峰值 < 30%）的工位，避免把正常工位算成空闲
    top_idle: sorted
      .slice()
      .reverse()
      .filter((row) => Number(row.peak_utilization_pct || 0) < 30)
      .slice(0, n)
      .map(brief),
    threshold: { overload_pct: 100, idle_pct: 30 },
  };
}

module.exports = { buildInstanceBreakdown, buildWorkstationUtilization, pickBottlenecks };
