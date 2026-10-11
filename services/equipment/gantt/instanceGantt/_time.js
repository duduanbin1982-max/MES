"use strict";
// services/equipment/gantt/instanceGantt/_time.js
// 时间常量与工具。(原 services/equipment/gantt/instanceGantt.js 第 7-53 行)

const HOURS_PER_WORKDAY = 8;
const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

function addHours(date, hours) {
  return new Date(date.getTime() + Number(hours || 0) * MS_PER_HOUR);
}

function hoursBetween(start, end) {
  return Math.max(0, (end.getTime() - start.getTime()) / MS_PER_HOUR);
}

function daysBetween(start, end) {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY));
}

module.exports = { HOURS_PER_WORKDAY, MS_PER_HOUR, MS_PER_DAY, parseDate, pad, formatDateTime, addHours, hoursBetween, daysBetween };
