"use strict";
// services/equipment/gantt/resourcesGantt/_conflicts.js
// 冲突检测: 同工位时间重叠 + 单日超出产能。
// (原 services/equipment/gantt/resourcesGantt.js 第 260-307 行)

const { MS_PER_HOUR } = require("./_time");

function detectConflicts(items, heatmapGrid, workstationById) {
  const conflicts = [];
  const byWorkstation = {};
  for (const item of items) {
    if (!item.ws_id) continue;
    if (!byWorkstation[item.ws_id]) byWorkstation[item.ws_id] = [];
    byWorkstation[item.ws_id].push(item);
  }

  for (const wsId of Object.keys(byWorkstation)) {
    const list = byWorkstation[wsId].sort((a, b) => a._start - b._start);
    for (let index = 0; index < list.length - 1; index++) {
      const current = list[index];
      const next = list[index + 1];
      const overlapMs = Math.min(current._end.getTime(), next._end.getTime()) - Math.max(current._start.getTime(), next._start.getTime());
      const overlapHours = overlapMs / MS_PER_HOUR;
      if (overlapHours > 0.05) {
        conflicts.push({
          type: current.instance_id !== next.instance_id ? "cross_instance" : "same_workstation",
          workstation: current.workstation,
          ws_id: Number.parseInt(wsId, 10),
          items: [
            { id: current.id, name: current.name, instance: current.instance_code, start: current.start, end: current.end },
            { id: next.id, name: next.name, instance: next.instance_code, start: next.start, end: next.end },
          ],
          overlap_hours: Math.round(overlapHours * 10) / 10,
        });
      }
    }
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

  return conflicts;
}

module.exports = { detectConflicts };
