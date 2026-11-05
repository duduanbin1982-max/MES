"use strict";
// services/equipment/gantt/resourcesGantt/_items.js
// 源数据准备与条目归一化。
// (原 services/equipment/gantt/resourcesGantt.js 第 9-11、45-85、134-170 行)
//
// 2026-11-05（审计 F-03/F-02）：
//   · 起止时间优先用"计划"（planned_start/planned_end），没有计划才退回实际，避免把历史实际
//     当成未来负荷（原实现是 actual 优先）；
//   · 只有 planned_end 没有 planned_start 的行，用「结束 - 工时」回推开始，不再被整条丢弃；
//   · 条目增加 start_basis / end_basis / hours_basis，前端可解释"这条是计划还是实际"。

const { parseDate, addHours, formatDate, formatDateTime, hoursBetween } = require("./_time");

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

/**
 * P2-1（2026-10-19）：工位「每日可用工时」。
 *
 * 原实现是 capacity_per_day × 8 —— 但 capacity_per_day 是**产出能力（件/天）**，
 * 50 件/天 × 8 = 400 小时/天，明显不是工时容量，导致利用率被稀释成 1~2%，
 * "最紧工位"根本看不出来。
 *
 * 现改为按班次推导：白班/夜班 = 8h，双班 = 16h，三班 = 24h，再乘 max_workers（多工位并行）。
 * capacity_per_day 保留在响应里作为"件/天产能"参考，不再参与工时计算。
 */
function workstationDailyCapacity(workstation) {
  const baseHours = Number(process.env.WORKSTATION_SHIFT_HOURS || 8) || 8;
  const shift = String(workstation.shift || "day").toLowerCase();
  const shiftHours = shift.includes("three") || shift.includes("三班")
    ? baseHours * 3
    : shift.includes("two") || shift.includes("double") || shift.includes("双班")
      ? baseHours * 2
      : baseHours;
  const workers = Math.max(1, Number(workstation.max_workers || 1) || 1);
  return Math.min(24, shiftHours * workers);
}

function normalizeItem(row, type) {
  const estimatedHours = Number(row.estimated_hours || 0) || 0;
  const defaultHours = type === "work_order" ? 8 : 4;
  const deriveHours = estimatedHours > 0 ? estimatedHours : defaultHours;

  const plannedStart = parseDate(row.planned_start);
  const plannedEnd = parseDate(row.planned_end);
  const actualStart = parseDate(row.actual_start);
  const actualEnd = parseDate(row.actual_end);

  // 计划优先；只有实际时退回实际；只有结束时间时用「结束 - 工时」回推开始
  let start = plannedStart || actualStart;
  let startBasis = plannedStart ? "planned" : actualStart ? "actual" : "derived";
  let end = plannedEnd || actualEnd;
  let endBasis = plannedEnd ? "planned" : actualEnd ? "actual" : "derived";
  if (!start && end) {
    start = addHours(end, -deriveHours);
    startBasis = "derived";
  }
  if (!start) return null;
  if (!end) {
    end = addHours(start, deriveHours);
    endBasis = "derived";
  }
  if (end <= start) {
    end = addHours(start, deriveHours || 1);
    endBasis = "derived";
  }

  const calendarHours = Math.max(0.25, hoursBetween(start, end));
  const hours = estimatedHours > 0 ? estimatedHours : calendarHours;
  const hoursBasis = estimatedHours > 0 ? "estimated" : "calendar";
  return {
    id: `${type === "work_order" ? "wo" : "pn"}_${row.id}`,
    source_id: row.id,
    type,
    name: type === "work_order" ? `${row.wo_code || ""} ${row.title || ""}`.trim() : (row.operation_name || `工序 ${row.id}`),
    workstation: row.ws_name || "未分配",
    ws_id: row.ws_id,
    instance_id: row.instance_id,
    instance_code: row.instance_code,
    instance_name: row.instance_name,
    start,
    end,
    start_text: formatDateTime(start),
    end_text: formatDateTime(end),
    start_date: formatDate(start),
    end_date: formatDate(end),
    status: row.status || "pending",
    hours: Math.round(hours * 10) / 10,
    calendar_hours: Math.round(calendarHours * 10) / 10,
    hours_basis: hoursBasis,
    start_basis: startBasis,
    end_basis: endBasis,
  };
}

function overlapsWindow(item, rangeStart, rangeEnd) {
  return item.end > rangeStart && item.start < rangeEnd;
}

const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

/**
 * 工单与工序统一归一化，丢掉无法定位开始时间的行。
 * @param {object} [options] { includeCompleted?: boolean } 默认排除已完成/已取消（规划视角）
 */
function collectItems(workOrders, processNodes, rangeStart, rangeEnd, options = {}) {
  const rawItems = [
    ...workOrders.map((row) => normalizeItem(row, "work_order")),
    ...processNodes.map((row) => normalizeItem(row, "process_node")),
  ].filter(Boolean);

  const windowed = rawItems.filter((item) => overlapsWindow(item, rangeStart, rangeEnd));
  const visible = options.includeCompleted === true
    ? windowed
    : windowed.filter((item) => !CLOSED_STATUSES.has(String(item.status)));

  return visible.map((item) => ({
    id: item.id,
    source_id: item.source_id,
    type: item.type,
    name: item.name,
    workstation: item.workstation,
    ws_id: item.ws_id,
    instance_id: item.instance_id,
    instance_code: item.instance_code,
    instance_name: item.instance_name,
    start: item.start_text,
    end: item.end_text,
    start_date: item.start_date,
    end_date: item.end_date,
    status: item.status,
    hours: item.hours,
    calendar_hours: item.calendar_hours,
    hours_basis: item.hours_basis,
    start_basis: item.start_basis,
    end_basis: item.end_basis,
    _start: item.start,
    _end: item.end,
  }));
}

/** 同上，但额外返回被排除的已完成/已取消条数（供页面提示） */
function collectItemsDetailed(workOrders, processNodes, rangeStart, rangeEnd, options = {}) {
  const rawItems = [
    ...workOrders.map((row) => normalizeItem(row, "work_order")),
    ...processNodes.map((row) => normalizeItem(row, "process_node")),
  ].filter(Boolean);
  const windowed = rawItems.filter((item) => overlapsWindow(item, rangeStart, rangeEnd));
  const visible = options.includeCompleted === true
    ? windowed
    : windowed.filter((item) => !CLOSED_STATUSES.has(String(item.status)));
  return {
    items: collectItems(workOrders, processNodes, rangeStart, rangeEnd, options),
    excluded_completed_count: windowed.length - visible.length,
  };
}

// (原第 162-170 行)
function loadWorkstations(db) {
  return all(db, `
    SELECT id, name, workshop, capacity_per_day, max_workers, shift
    FROM workstations
    WHERE is_active = 1
    ORDER BY id
  `).map((workstation) => ({
    ...workstation,
    daily_capacity_hours: workstationDailyCapacity(workstation),
  }));
}

module.exports = {
  all,
  workstationDailyCapacity,
  normalizeItem,
  overlapsWindow,
  collectItems,
  collectItemsDetailed,
  loadWorkstations,
  CLOSED_STATUSES,
};
