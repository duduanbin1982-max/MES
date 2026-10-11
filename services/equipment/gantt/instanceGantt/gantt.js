"use strict";
// services/equipment/gantt/instanceGantt/gantt.js
// GET /api/equipment_instances/:id/gantt
// 单项目甘特：优先使用 process_nodes 的真实 planned_start/planned_end；
// 未排程节点才按依赖关系和标准工时做只读 fallback，避免 Gantt 与项目排程口径脱节。
// (原 services/equipment/gantt/instanceGantt.js 第 117-218 行)

const { formatDateTime, parseDate, addHours, hoursBetween, daysBetween, HOURS_PER_WORKDAY } = require("./_time");
const { nodeWorkHours, buildFallbackScheduler } = require("./_scheduler");

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, ...params) {
  return db.prepare(sql).get(...params);
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
      bars: [],
      status_summary: {},
    });
  }

  const deps = all(db, "SELECT predecessor_id, successor_id FROM process_dependencies WHERE equipment_instance_id = ?", instanceId);
  const fallback = buildFallbackScheduler(nodes, deps, configuredStart);
  const bars = [];

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
      duration_days: daysBetween(plannedStart, plannedEnd),
      duration_hours: Math.round(workHours * 10) / 10,
      calendar_hours: Math.round(calendarHours * 10) / 10,
      status: node.status || "pending",
      progress: node.status === "completed" ? 100 : (node.status === "in_progress" ? 50 : 0),
      bom_node_id: node.bom_node_id,
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
  for (const bar of bars) statusSummary[bar.status] = (statusSummary[bar.status] || 0) + 1;

  res.json({
    instance: { id: inst.id, code: inst.instance_code, name: inst.instance_name },
    project_start: formatDateTime(minStart),
    project_end: formatDateTime(maxEnd),
    total_hours: Math.round(totalCalendarHours * 10) / 10,
    total_days: Math.ceil(totalCalendarHours / 24),
    total_weeks: Math.round(totalCalendarHours / (24 * 7) * 10) / 10,
    total_work_hours: Math.round(bars.reduce((sum, bar) => sum + Number(bar.duration_hours || 0), 0) * 10) / 10,
    scheduled_count: bars.filter((bar) => bar.scheduled).length,
    unscheduled_count: bars.filter((bar) => !bar.scheduled).length,
    dependency_count: deps.length,
    status_summary: statusSummary,
    bars,
  });
}

module.exports = { getInstanceGantt };
