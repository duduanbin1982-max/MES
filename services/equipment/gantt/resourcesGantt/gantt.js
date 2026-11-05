"use strict";
// services/equipment/gantt/resourcesGantt/gantt.js
// GET /api/resources/gantt
// 多项目资源甘特：按时间窗口过滤真实计划/实际任务，按工位产能计算利用率和冲突。
// (原 services/equipment/gantt/resourcesGantt.js 第 87-330 行)
//
// 2026-10-11 拆分：原先是一个 244 行的单函数，现按阶段拆成命名步骤，
// 每步都在独立模块里，getResourcesGantt 只负责编排与组装响应。
//
// 2026-11-05（审计整改）：
//   · 默认排除已完成/已取消任务（规划视角），?include_completed=1 可看历史；
//   · summary 增加 window_busy_hours（热力图合计，窗口内真实占用）与 excluded_completed_count；
//   · 冲突由 _conflicts 聚合（工位 × 重叠簇）。

const { formatDate } = require("./_time");
const { collectItemsDetailed, loadWorkstations } = require("./_items");
const { resolveWindow } = require("./_window");
const { loadSourceRows } = require("./_queries");
const { buildHeatmap } = require("./_heatmap");
const { buildInstanceBreakdown, buildWorkstationUtilization, pickBottlenecks } = require("./_breakdown");
const { detectConflicts } = require("./_conflicts");

function getResourcesGantt(req, res, db) {
  const { rangeStart, numDays, rangeEnd, instanceFilter, compare } = resolveWindow(req.query);
  const includeCompleted = req.query.include_completed === "1" || req.query.include_completed === "true";
  const { workOrders, processNodes } = loadSourceRows(db, instanceFilter);
  const collected = collectItemsDetailed(workOrders, processNodes, rangeStart, rangeEnd, { includeCompleted });
  const items = collected.items;
  const workstations = loadWorkstations(db);
  const { workstationById, dayList, heatmapGrid } = buildHeatmap(workstations, items, rangeStart, numDays);
  const instanceBreakdown = buildInstanceBreakdown(items);
  const workstationUtilization = buildWorkstationUtilization(heatmapGrid);
  // P2-1：最紧 / 最空闲的三个工位（排程页 Top3 卡片直接用）
  const bottlenecks = pickBottlenecks(workstationUtilization, 3);
  const conflicts = detectConflicts(items, heatmapGrid, workstationById);

  const publicItems = items.map(({ _start, _end, ...item }) => item);
  const windowBusyHours = Math.round(heatmapGrid.reduce((sum, row) => sum + Number(row.total_busy_hours || 0), 0) * 10) / 10;

  res.json({
    start_date: formatDate(rangeStart),
    end_date: formatDate(rangeEnd),
    num_days: numDays,
    filter: { instance_id: instanceFilter, compare: compare === "1", include_completed: includeCompleted },
    workstations,
    summary: {
      total_items: publicItems.length,
      total_hours: Math.round(publicItems.reduce((sum, item) => sum + Number(item.hours || 0), 0) * 10) / 10,
      window_busy_hours: windowBusyHours,
      excluded_completed_count: collected.excluded_completed_count,
      instance_count: instanceBreakdown.length,
      workstation_count: workstations.length,
      conflict_count: conflicts.length,
    },
    heatmap: { days: dayList, grid: heatmapGrid },
    instance_breakdown: instanceBreakdown,
    workstation_utilization: workstationUtilization,
    bottlenecks,
    items: publicItems,
    conflicts,
  });
}

module.exports = { getResourcesGantt };
