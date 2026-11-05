"use strict";
// services/schedule/_helpers.js
// prepared statement 包装 + 整数/日期归一化。
// (原 services/scheduleService.js 第 48-62 行)
// 注意: 这里的 all/get/run 用 rest 参数 (...params), 与原实现一致。

function makeDbHelpers(db) {
  return {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
  };
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// 2026-11-05（审计 F-08）：统一成 'YYYY-MM-DD HH:MM:SS'（兼容 ISO 带 T/Z / 纯日期），
// 不再直接 slice(0,19) —— 那样会把 '2026-11-05T12:00:00.000Z' 存成带 T 的字符串。
function normalizeDate(value) {
  const { normalizeSqlDateTime } = require("../../shared/datetime");
  return normalizeSqlDateTime(value);
}

module.exports = { makeDbHelpers, toInt, normalizeDate };
