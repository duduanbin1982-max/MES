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

function normalizeDate(value) {
  return value ? String(value).slice(0, 19) : null;
}

module.exports = { makeDbHelpers, toInt, normalizeDate };
