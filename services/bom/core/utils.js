"use strict";

function normalizeInt(value, fallback = null) {
  if (value === "" || value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeFloat(value, fallback = null) {
  if (value === "" || value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBool(value) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "yes", "y", "是"].includes(s)) return 1;
    if (["false", "no", "n", "否"].includes(s)) return 0;
  }
  return 0;
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function tableExists(db, name) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return !!row;
  } catch (_e) {
    return false;
  }
}

function tableColumns(db, name) {
  if (!tableExists(db, name)) return new Set();
  try {
    return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name));
  } catch (_e) {
    return new Set();
  }
}

function hasColumns(db, tableName, columns) {
  const cols = tableColumns(db, tableName);
  return columns.every((name) => cols.has(name));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round3(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function round4(value) {
  return Math.round((value || 0) * 10000) / 10000;
}

function earliestDate(values) {
  const list = values.filter(Boolean).map((value) => String(value));
  if (!list.length) return null;
  list.sort();
  return list[0];
}

function uniqText(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function isActiveShortageStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return !["closed", "resolved", "arrived", "received", "cancelled"].includes(value);
}

function isResolvedShortageStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return ["closed", "arrived", "received"].includes(value);
}

function buildChildrenMap(rows) {
  const childMap = new Map();
  for (const row of rows) {
    const parentId = normalizeInt(row.parent_id, null);
    if (!childMap.has(parentId)) childMap.set(parentId, []);
    childMap.get(parentId).push(row);
  }
  return childMap;
}

function collectDescendantIds(childMap, rootId) {
  const ids = new Set([Number(rootId)]);
  const stack = [...(childMap.get(Number(rootId)) || []).map((row) => Number(row.id))];
  while (stack.length) {
    const id = stack.pop();
    if (ids.has(id)) continue;
    ids.add(id);
    const children = childMap.get(id) || [];
    for (const child of children) stack.push(Number(child.id));
  }
  return ids;
}

function statusType(missing) {
  if (!missing || !missing.length) return "success";
  if (missing.some((item) => String(item).includes("未建立工序"))) return "danger";
  return "warning";
}

module.exports = {
  normalizeInt,
  normalizeFloat,
  normalizeBool,
  cleanText,
  tableExists,
  tableColumns,
  hasColumns,
  round2,
  round3,
  round4,
  earliestDate,
  uniqText,
  isActiveShortageStatus,
  isResolvedShortageStatus,
  buildChildrenMap,
  collectDescendantIds,
  statusType,
};
