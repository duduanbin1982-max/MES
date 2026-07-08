"use strict";
// db/profiler.js
// P1-2 SQLite 慢查询日志 + 统计
//   - 包装 db.prepare, 记录每次 prepare().all/get/run 耗时
//   - 超过阈值 (默认 50ms) 输出到慢查询日志
//   - 累计统计: calls / total_ms / slow_count
// Author: 三狗子 | Date: 2026-06-25

const fs = require("fs");
const path = require("path");

const SLOW_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "50", 10);
const SLOW_LOG_PATH = process.env.SLOW_QUERY_LOG || path.join(__dirname, "..", "logs", "slow-queries.log");
const PROFILE_ENABLED = process.env.DISABLE_QUERY_PROFILE !== "1";

// 全局统计
const stats = {
  calls: 0,
  totalMs: 0,
  slowCount: 0,
  avgMs: 0,
  maxMs: 0,
  minMs: Infinity,
  lastReset: Date.now(),
};

function ensureLogDir() {
  const dir = path.dirname(SLOW_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logSlow(sql, params, durationMs) {
  ensureLogDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    duration_ms: Math.round(durationMs * 100) / 100,
    sql: sql.slice(0, 500),
    params: params ? JSON.stringify(params).slice(0, 200) : null,
  });
  fs.appendFileSync(SLOW_LOG_PATH, line + "\n");
}

/**
 * 包装 better-sqlite3 Database 实例
 * @param {import("better-sqlite3").Database} db
 * @returns {import("better-sqlite3").Database} 包装后的实例 (接口兼容)
 */
function install(db) {
  if (!PROFILE_ENABLED) return db;

  const origPrepare = db.prepare.bind(db);

  db.prepare = function (sql) {
    const stmt = origPrepare(sql);

    // 包装 .all()
    const origAll = stmt.all.bind(stmt);
    stmt.all = function (...params) {
      const start = process.hrtime.bigint();
      let result;
      try { result = origAll(...params); } finally {
        const dur = Number(process.hrtime.bigint() - start) / 1e6;
        record(sql, params, dur);
      }
      return result;
    };

    // 包装 .get()
    const origGet = stmt.get.bind(stmt);
    stmt.get = function (...params) {
      const start = process.hrtime.bigint();
      let result;
      try { result = origGet(...params); } finally {
        const dur = Number(process.hrtime.bigint() - start) / 1e6;
        record(sql, params, dur);
      }
      return result;
    };

    // 包装 .run()
    const origRun = stmt.run.bind(stmt);
    stmt.run = function (...params) {
      const start = process.hrtime.bigint();
      let result;
      try { result = origRun(...params); } finally {
        const dur = Number(process.hrtime.bigint() - start) / 1e6;
        record(sql, params, dur);
      }
      return result;
    };

    return stmt;
  };

  return db;
}

function record(sql, params, durationMs) {
  stats.calls++;
  stats.totalMs += durationMs;
  if (durationMs > stats.maxMs) stats.maxMs = durationMs;
  if (durationMs < stats.minMs) stats.minMs = durationMs;
  stats.avgMs = stats.totalMs / stats.calls;

  if (durationMs >= SLOW_THRESHOLD_MS) {
    stats.slowCount++;
    logSlow(sql, params, durationMs);
  }
}

function getStats() {
  return {
    ...stats,
    uptime_sec: Math.floor((Date.now() - stats.lastReset) / 1000),
    qps: stats.uptime_sec > 0 ? Math.round(stats.calls / stats.uptime_sec) : 0,
  };
}

function reset() {
  stats.calls = 0;
  stats.totalMs = 0;
  stats.slowCount = 0;
  stats.avgMs = 0;
  stats.maxMs = 0;
  stats.minMs = Infinity;
  stats.lastReset = Date.now();
}

module.exports = { install, getStats, reset, stats };
