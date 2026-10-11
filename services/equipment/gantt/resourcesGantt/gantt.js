"use strict";
// services/equipment/gantt/resourcesGantt/gantt.js
// GET /api/resources/gantt
// 多项目资源甘特：按时间窗口过滤真实计划/实际任务，按工位产能计算利用率和冲突。
// (原 services/equipment/gantt/resourcesGantt.js 第 87-330 行)
//
// 2026-10-11 拆分：原先是一个 244 行的单函数，现按阶段拆成命名步骤，
// 每步都在独立模块里，getResourcesGantt 只负责编排与组装响应。

const { formatDate } = require("./_time");
const { collectItems, loadWorkstations } = require("./_items");
const { resolveWindow } = require("./_window");
const { loadSourceRows } = require("./_queries");
const { buildHeatmap } = require("./_heatmap");
const { buildInstanceBreakdown, buildWorkstationUtilization } = require("./_breakdown");
const { detectConflicts } = require("./_conflicts");

function getResourcesGantt(req, res, db) {
  const { rangeStart, numDays, rangeEnd, instanceFilter, compare } = resolveWindow(req.query);
  const { workOrders, processNodes } = loadSourceRows(db, instanceFilter);
  const items = collectItems(workOrders, processNodes, rangeStart, rangeEnd);
  const workstations = loadWorkstations(db);
  const { workstationById, dayList, heatmapGrid } = buildHeatmap(workstations, items, rangeStart, numDays);
  const instanceBreakdown = buildInstanceBreakdown(items);
  const workstationUtilization = buildWorkstationUtilization(heatmapGrid);
  const conflicts = detectConflicts(items, heatmapGrid, workstationById);

  const publicItems = items.map(({ _start, _end, ...item }) => item);

  res.json({
    start_date: formatDate(rangeStart),
    end_date: formatDate(rangeEnd),
    num_days: numDays,
    filter: { instance_id: instanceFilter, compare: compare === "1" },
    workstations,
    summary: {
      total_items: publicItems.length,
      total_hours: Math.round(publicItems.reduce((sum, item) => sum + Number(item.hours || 0), 0) * 10) / 10,
      instance_count: instanceBreakdown.length,
      workstation_count: workstations.length,
      conflict_count: conflicts.length,
    },
    heatmap: { days: dayList, grid: heatmapGrid },
    instance_breakdown: instanceBreakdown,
    workstation_utilization: workstationUtilization,
    items: publicItems,
    conflicts,
  });
}

module.exports = { getResourcesGantt };
