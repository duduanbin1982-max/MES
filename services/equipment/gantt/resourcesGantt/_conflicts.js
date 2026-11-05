"use strict";
// services/equipment/gantt/resourcesGantt/_conflicts.js
// 冲突检测: 同工位时间重叠 / 跨项目抢占 / 单日超出产能。
//
// 2026-11-05（审计 F-07）：同工位重叠原先按"相邻两条"各生成一行 —— 123 个工序叠在同一天时
// 页面会刷出 115 行几乎相同的冲突。现在按「工位 + 重叠簇」聚合：一个簇一行，
// 带任务数、涉及项目、超出工时和样本任务；产能超载仍按"工位 × 日"一行。

const { formatDate, formatDateTime } = require("./_time");

const SAMPLE_LIMIT = 5;

function clusterByWorkstation(items) {
  const byWorkstation = new Map();
  for (const item of items) {
    if (!item.ws_id) continue;
    const key = Number(item.ws_id);
    if (!byWorkstation.has(key)) byWorkstation.set(key, []);
    byWorkstation.get(key).push(item);
  }

  const clusters = [];
  for (const [wsId, list] of byWorkstation) {
    list.sort((a, b) => a._start - b._start || a._end - b._end);
    let current = null;
    for (const item of list) {
      if (!current || item._start.getTime() >= current.end.getTime()) {
        current = { wsId, items: [item], start: item._start, end: item._end };
        clusters.push(current);
      } else {
        current.items.push(item);
        if (item._end > current.end) current.end = item._end;
      }
    }
  }
  return clusters.filter((cluster) => cluster.items.length >= 2);
}

/** 簇内两两重叠工时（超过 PAIR_LIMIT 条时用"峰值并发"估算，避免 O(n²) 卡死） */
function clusterOverlap(items, clusterStart, clusterEnd) {
  const PAIR_LIMIT = 300;
  const MS = 3600 * 1000;
  if (items.length > PAIR_LIMIT) {
    // 峰值并发：按开始/结束事件扫描
    const events = [];
    for (const item of items) {
      events.push({ t: item._start.getTime(), delta: 1 });
      events.push({ t: item._end.getTime(), delta: -1 });
    }
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) {
      current += event.delta;
      if (current > peak) peak = current;
    }
    const spanHours = (clusterEnd.getTime() - clusterStart.getTime()) / MS;
    return { overlapHours: Math.max(0, (peak - 1) * spanHours), peakConcurrency: peak };
  }
  let overlapMs = 0;
  for (let i = 0; i < items.length - 1; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const start = Math.max(items[i]._start.getTime(), items[j]._start.getTime());
      const end = Math.min(items[i]._end.getTime(), items[j]._end.getTime());
      if (end > start) overlapMs += end - start;
    }
  }
  return { overlapHours: overlapMs / MS, peakConcurrency: null };
}

function detectConflicts(items, heatmapGrid, workstationById) {
  const conflicts = [];

  for (const cluster of clusterByWorkstation(items)) {
    const instances = [...new Set(cluster.items.map((item) => item.instance_code || "N/A"))];
    const { overlapHours, peakConcurrency } = clusterOverlap(cluster.items, cluster.start, cluster.end);
    conflicts.push({
      type: instances.length > 1 ? "cross_instance" : "same_workstation",
      workstation: cluster.items[0].workstation,
      ws_id: cluster.wsId,
      day: formatDate(cluster.start),
      start: formatDateTime(cluster.start),
      end: formatDateTime(cluster.end),
      item_count: cluster.items.length,
      instance_codes: instances,
      peak_concurrency: peakConcurrency,
      overlap_hours: Math.round(overlapHours * 10) / 10,
      items: cluster.items.slice(0, SAMPLE_LIMIT).map((item) => ({
        id: item.id,
        name: item.name,
        instance: item.instance_code,
        start: item.start,
        end: item.end,
      })),
    });
  }

  for (const heatmapRow of heatmapGrid) {
    const workstation = workstationById.get(Number(heatmapRow.ws_id));
    const capacity = workstation ? workstation.daily_capacity_hours : 8;
    for (const cell of heatmapRow.cells) {
      if (cell.busy_hours > capacity + 0.1) {
        conflicts.push({
          type: "capacity_overload",
          workstation: heatmapRow.name,
          ws_id: heatmapRow.ws_id,
          day: cell.day,
          busy_hours: cell.busy_hours,
          capacity_hours: capacity,
          utilization_pct: cell.utilization_pct,
          overlap_hours: Math.round((cell.busy_hours - capacity) * 10) / 10,
        });
      }
    }
  }

  const rank = { capacity_overload: 0, cross_instance: 1, same_workstation: 2 };
  conflicts.sort((a, b) => {
    const byType = (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
    if (byType !== 0) return byType;
    const byHours = Number(b.overlap_hours || 0) - Number(a.overlap_hours || 0);
    if (byHours !== 0) return byHours;
    return String(a.day || "").localeCompare(String(b.day || ""));
  });

  return conflicts;
}

module.exports = { detectConflicts, clusterByWorkstation };
