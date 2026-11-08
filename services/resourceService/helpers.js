"use strict";
// services/resourceService/helpers.js
// 2026-11-08（工位/资源审计）：工位容量、状态、归属校验的公共实现。
const { ApiError } = require("../../app/errors");
const { STATION_TYPES, jsonText, safeJson } = require("./catalog");

const STATION_STATUSES = ["available", "occupied", "maintenance", "blocked", "disabled"];
const WORKER_AVAILABILITIES = ["idle", "online", "busy", "offline", "leave"];
const SHIFTS = ["day", "night", "double"];

function positiveInt(value, field, { min = 1, max = 100000 } = {}) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) throw ApiError.validation(`${field} 需为 ${min}~${max} 的整数`);
  return num;
}

function text(value, field, { max = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw ApiError.validation(`${field} 必填`);
    return null;
  }
  if (normalized.length > max) throw ApiError.validation(`${field} 长度不能超过 ${max}`);
  return normalized;
}

function boolInt(value, fallback = 1) {
  if (value === undefined) return fallback;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return 1;
}

function validateWorkstationPayload(body, { partial = false } = {}) {
  const source = body || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
  const payload = {};
  if (!partial || has("code")) payload.code = text(source.code, "code", { max: 64, required: true });
  if (!partial || has("name")) payload.name = text(source.name, "name", { max: 100, required: true });
  if (!partial || has("workshop")) payload.workshop = text(source.workshop, "workshop", { max: 100 });
  if (!partial || has("station_type")) {
    const type = text(source.station_type, "station_type", { max: 40 }) || "general";
    if (!STATION_TYPES.some((item) => item.value === type)) throw ApiError.validation("station_type 非法");
    payload.station_type = type;
  }
  if (!partial || has("status")) {
    const status = text(source.status, "status", { max: 30 }) || "available";
    if (!STATION_STATUSES.includes(status)) throw ApiError.validation(`status 必须是 ${STATION_STATUSES.join(" / ")}`);
    payload.status = status;
  }
  if (!partial || has("capacity_per_day")) payload.capacity_per_day = positiveInt(source.capacity_per_day ?? 1, "capacity_per_day");
  if (!partial || has("max_workers")) payload.max_workers = positiveInt(source.max_workers ?? source.capacity_per_day ?? 1, "max_workers");
  if (!partial || has("capability_tags")) payload.capability_tags = jsonText(source.capability_tags || []);
  if (!partial || has("required_skills")) payload.required_skills = jsonText(source.required_skills || []);
  if (!partial || has("location")) payload.location = text(source.location, "location", { max: 100 });
  if (!partial || has("shift")) {
    const shift = text(source.shift, "shift", { max: 20 }) || "day";
    if (!SHIFTS.includes(shift)) throw ApiError.validation(`shift 必须是 ${SHIFTS.join(" / ")}`);
    payload.shift = shift;
  }
  if (!partial || has("notes")) payload.notes = text(source.notes, "notes", { max: 1000 });
  if (!partial || has("is_active")) payload.is_active = boolInt(source.is_active, 1);
  return payload;
}

function getWorkstation(context, id, { requireActive = true } = {}) {
  const station = context.get("SELECT * FROM workstations WHERE id = ?", Number(id));
  if (!station) throw ApiError.notFound("工位不存在");
  if (requireActive && Number(station.is_active) !== 1) throw ApiError.validation("工位已停用");
  if (requireActive && station.status === "disabled") throw ApiError.validation("工位已停用（status=disabled）");
  return station;
}

function capacityOf(station) {
  return Math.max(1, Number(station.max_workers || station.capacity_per_day || 1));
}

function assignedCount(context, workstationId, excludeUserId = null) {
  return context.get(
    "SELECT COUNT(*) c FROM users WHERE workstation_id = ? AND availability IN ('busy','online') AND id <> ?",
    Number(workstationId), Number(excludeUserId || 0)
  ).c || 0;
}

function assertCapacity(context, station, userId) {
  const used = assignedCount(context, station.id, userId);
  const cap = capacityOf(station);
  if (used >= cap) throw ApiError.validation(`工位人员容量已满（${used}/${cap}）`);
  return { used, capacity: cap };
}

function assertAvailability(value, fallback = "busy") {
  const availability = text(value, "availability", { max: 20 }) || fallback;
  if (!WORKER_AVAILABILITIES.includes(availability)) throw ApiError.validation(`availability 必须是 ${WORKER_AVAILABILITIES.join(" / ")}`);
  if (!["busy", "online"].includes(availability)) throw ApiError.validation("分配工位时 availability 只能是 busy / online");
  return availability;
}

function assertOptionalReference(context, table, id, label) {
  if (id === undefined || id === null || id === "") return null;
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) throw ApiError.validation(`${label} 非法`);
  try {
    const row = context.get(`SELECT id FROM ${table} WHERE id = ?`, value);
    if (!row) throw ApiError.validation(`${label} 不存在: ${value}`);
    return value;
  } catch (error) {
    if (error && error.status === 400) throw error;
    return value; // 兼容精简库缺表
  }
}

module.exports = {
  STATION_STATUSES, WORKER_AVAILABILITIES, SHIFTS,
  validateWorkstationPayload, getWorkstation, capacityOf, assignedCount, assertCapacity,
  assertAvailability, assertOptionalReference, safeJson,
};
