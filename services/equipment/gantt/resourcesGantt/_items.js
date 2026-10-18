"use strict";
// services/equipment/gantt/resourcesGantt/_items.js
// 源数据准备与条目归一化。
// (原 services/equipment/gantt/resourcesGantt.js 第 9-11、45-85、134-170 行)

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
  const start = parseDate(row.actual_start || row.planned_start);
  if (!start) return null;

  const explicitEnd = parseDate(row.actual_end || row.planned_end);
  const estimatedHours = Number(row.estimated_hours || 0) || (type === "work_order" ? 8 : 4);
  let end = explicitEnd || addHours(start, estimatedHours);
  if (!end || end <= start) end = addHours(start, estimatedHours || 1);

  const calendarHours = Math.max(0.25, hoursBetween(start, end));
  const hours = estimatedHours > 0 ? estimatedHours : calendarHours;
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
  };
}

function overlapsWindow(item, rangeStart, rangeEnd) {
  return item.end > rangeStart && item.start < rangeEnd;
}

// (原第 134-137 行) 工单与工序统一归一化，丢掉无法定位开始时间的行
function collectItems(workOrders, processNodes, rangeStart, rangeEnd) {
  const rawItems = [
    ...workOrders.map((row) => normalizeItem(row, "work_order")),
    ...processNodes.map((row) => normalizeItem(row, "process_node")),
  ].filter(Boolean);

  return rawItems
    .filter((item) => overlapsWindow(item, rangeStart, rangeEnd))
    .map((item) => ({
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
      _start: item.start,
      _end: item.end,
    }));
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

module.exports = { all, workstationDailyCapacity, normalizeItem, overlapsWindow, collectItems, loadWorkstations };
