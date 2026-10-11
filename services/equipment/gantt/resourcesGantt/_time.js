"use strict";
// services/equipment/gantt/resourcesGantt/_time.js
// 时间工具。(原 services/equipment/gantt/resourcesGantt.js 第 6-43 行)

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

function formatDate(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function formatDateTime(date) {
  return `${formatDate(date)} ${[pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":")}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * MS_PER_DAY);
}

function addHours(date, hours) {
  return new Date(date.getTime() + Number(hours || 0) * MS_PER_HOUR);
}

function hoursBetween(start, end) {
  return Math.max(0, (end.getTime() - start.getTime()) / MS_PER_HOUR);
}

module.exports = { MS_PER_HOUR, MS_PER_DAY, parseDate, pad, formatDate, formatDateTime, addDays, addHours, hoursBetween };
