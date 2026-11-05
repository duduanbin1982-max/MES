"use strict";
// services/equipment/gantt/instanceGantt/gantt.js
// GET /api/equipment_instances/:id/gantt
// 单项目甘特：优先使用 process_nodes 的真实 planned_start/planned_end；
// 未排程节点才按依赖关系和标准工时做只读 fallback，避免 Gantt 与项目排程口径脱节。
//
// 2026-11-05（审计 F-06 整改）：
//   · 进度不再只按状态给 0/50/100：进行中节点按"已开工时长 / 计划跨度"估算（5%~95%），
//     并返回 progress_basis 说明依据；
//   · 返回项目级 progress_pct（按工时加权），供页面顶部展示；
//   · 依赖查询带上 dep_type / lag_hours，交给 fallback 使用（F-05）。

const { formatDateTime, parseDate, addHours, hoursBetween, daysBetween, HOURS_PER_WORKDAY } = require("./_time");
const { nodeWorkHours, buildFallbackScheduler } = require("./_scheduler");

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** 进度估算：完成 100；进行中按已开工时长占计划跨度估算（5~95）；其它 0 */
function computeProgress(node, plannedStart, plannedEnd, nowMs) {
  const status = String(node.status || "pending");
  if (status === "completed") return { pct: 100, basis: "status" };
  if (status === "in_progress" || status === "paused") {
    const actualStart = parseDate(node.actual_start);
    const span = plannedEnd.getTime() - plannedStart.getTime();
    if (actualStart && span > 0) {
      const elapsed = Math.max(0, Math.min(nowMs, plannedEnd.getTime()) - actualStart.getTime());
      const pct = Math.round((elapsed / span) * 100);
      return { pct: Math.max(5, Math.min(95, pct)), basis: "actual_elapsed" };
    }
    return { pct: 50, basis: "status" };
  }
  return { pct: 0, basis: "status" };
}

function getInstanceGantt(req, res, db) {
  const instanceId = Number.parseInt(req.params.id, 10);
  const inst = get(db, "SELECT * FROM equipment_instances WHERE id = ?", instanceId);
  if (!inst) return res.status(404).json({ error: "instance not found" });

  const configuredStart = parseDate(inst.planned_start || inst.start_date) || new Date();
  const nodes = all(db, `
    SELECT pn.id, pn.operation_name, pn.status, pn.bom_node_id, pn.estimated_hours,
           pn.planned_start, pn.planned_end, pn.actual_start, pn.actual_end,
           pn.required_workstation_id, pn.phase_code, pn.subsystem_id,
           ws.name AS workstation_name,
           es.code AS subsystem_code,
           es.name_zh AS subsystem_name
    FROM process_nodes pn
    LEFT JOIN workstations ws ON ws.id = pn.required_workstation_id
    LEFT JOIN equipment_subsystems es ON es.id = pn.subsystem_id
    WHERE pn.equipment_instance_id = ?
    ORDER BY COALESCE(pn.planned_start, '9999-12-31'), pn.sequence, pn.id
  `, instanceId);

  if (!nodes.length) {
    return res.json({
      instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name },
      project_start: formatDateTime(configuredStart),
      total_hours: 0,
      total_days: 0,
      total_weeks: 0,
      total_work_hours: 0,
      progress_pct: 0,
      bars: [],
      status_summary: {},
    });
  }

  // 依赖带上类型与间隔（F-05：fallback 需要）
  const deps = all(db, "SELECT id, predecessor_id, successor_id, dep_type, lag_hours FROM process_dependencies WHERE equipment_instance_id = ?", instanceId);
  const fallback = buildFallbackScheduler(nodes, deps, configuredStart);
  const bars = [];
  const nowMs = Date.now();

  for (const node of nodes) {
    const plannedStart = parseDate(node.planned_start) || fallback.calcStart(Number(node.id));
    let plannedEnd = parseDate(node.planned_end) || fallback.calcEnd(Number(node.id));
    if (!plannedEnd || plannedEnd <= plannedStart) plannedEnd = addHours(plannedStart, nodeWorkHours(node));
    if (plannedEnd <= plannedStart) plannedEnd = addHours(plannedStart, HOURS_PER_WORKDAY);

    const actualStart = parseDate(node.actual_start);
    const actualEnd = parseDate(node.actual_end);
    const calendarHours = Math.max(1, hoursBetween(plannedStart, plannedEnd));
    const workHours = Math.max(0, Number(node.estimated_hours || 0)) || calendarHours;
    const subsystem = node.subsystem_name || node.subsystem_code || node.phase_code || "未分组";
    const progress = computeProgress(node, plannedStart, plannedEnd, nowMs);

    bars.push({
      id: node.id,
      name: node.operation_name || `工序 ${node.id}`,
      subsystem,
      phase_code: node.phase_code,
      workstation_id: node.required_workstation_id,
      workstation_name: node.workstation_name,
      start: formatDateTime(plannedStart),
      end: formatDateTime(plannedEnd),
      planned_start: formatDateTime(plannedStart),
      planned_end: formatDateTime(plannedEnd),
      actual_start: actualStart ? formatDateTime(actualStart) : null,
      actual_end: actualEnd ? formatDateTime(actualEnd) : null,
      has_actual_start: Boolean(actualStart),
      has_actual_end: Boolean(actualEnd),
      duration_days: daysBetween(plannedStart, plannedEnd),
      duration_hours: Math.round(workHours * 10) / 10,
      calendar_hours: Math.round(calendarHours * 10) / 10,
      status: node.status || "pending",
      progress: progress.pct,
      progress_basis: progress.basis,
      scheduled: Boolean(node.planned_start && node.planned_end),
    });
  }

  bars.sort((a, b) => a.start.localeCompare(b.start) || Number(a.id) - Number(b.id));

  const minStart = bars.reduce((min, bar) => {
    const value = parseDate(bar.start);
    return value && value < min ? value : min;
  }, parseDate(bars[0].start) || configuredStart);
  const maxEnd = bars.reduce((max, bar) => {
    const value = parseDate(bar.end);
    return value && value > max ? value : max;
  }, parseDate(bars[0].end) || configuredStart);

  const totalCalendarHours = Math.max(0, hoursBetween(minStart, maxEnd));
  const statusSummary = {};
  let weightedHours = 0;
  let weightedProgress = 0;
  for (const bar of bars) {
    statusSummary[bar.status] = (statusSummary[bar.status] || 0) + 1;
    weightedHours += Number(bar.duration_hours || 0);
    weightedProgress += Number(bar.duration_hours || 0) * Number(bar.progress || 0);
  }

  res.json({
    instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name },
    project_start: formatDateTime(minStart),
    project_end: formatDateTime(maxEnd),
    total_hours: Math.round(totalCalendarHours * 10) / 10,
    total_days: Math.ceil(totalCalendarHours / 24),
    total_weeks: Math.round(totalCalendarHours / (24 * 7) * 10) / 10,
    total_work_hours: Math.round(bars.reduce((sum, bar) => sum + Number(bar.duration_hours || 0), 0) * 10) / 10,
    progress_pct: weightedHours > 0 ? Math.round(weightedProgress / weightedHours) : 0,
    scheduled_count: bars.filter((bar) => bar.scheduled).length,
    unscheduled_count: bars.filter((bar) => !bar.scheduled).length,
    dependency_count: deps.length,
    status_summary: statusSummary,
    bars,
  });
}

module.exports = { getInstanceGantt, computeProgress };
