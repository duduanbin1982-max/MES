"use strict";
// app/logger.js
// 统一日志出口 (2026-10-11，静态分析 v1 #3)
//
// 背景
//   后端原先直接 `console.log/error/warn`（42 个文件、62 处），既没有级别控制，
//   也没有统一格式；systemd 把 stdout/stderr 一起 append 到 logs/mes.log。
//   本模块把后端日志收敛到 pino：
//     - 级别由 LOG_LEVEL 控制（默认 info；warning→warn；非法值回落 info；
//       silent/off/none 全静默），也可运行时 logger.setLevel() 调整；
//     - 每行一条 JSON，字段含 level/time/service/pid/hostname/module/msg；
//     - msg 与迁移前逐字一致（多参数走 util.format，与 console.* 同规则），
//       既有的 `grep '\[iotCollector\]'` 排障手法继续可用；
//     - 模块名用 createLogger("<name>") 固定成 module 字段，
//       不依赖从 msg 里解析 "[tag]"（那样会与 child 的 module 撞键）。
//
// 出口
//   stdout(fd 1)。systemd 单元 StandardOutput/StandardError 都是
//   `append:/home/dubin/factory-mes/logs/mes.log`；轮转由
//   /etc/logrotate.d/factory-mes (copytruncate + size 20M + rotate 14) 负责。
//   用同步目标 (sync: true)：本服务日志量很小，同步写保证顺序、退出不丢行，
//   也避免 pino 默认的 thread-stream worker 线程。
//
// 用法
//   const logger = require("../app/logger").createLogger("iotCollector");
//   logger.info("[iotCollector] Starting collector every %dms", interval);
//   logger.error("[iotCollector] Transaction error: %s", error.message);
//   logger.raw.debug({ deviceId: 7 }, "需要结构化字段时走 raw");

const util = require("node:util");
const os = require("node:os");
const pino = require("pino");

const LEVELS = Object.freeze(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const METHODS = Object.freeze(["fatal", "error", "warn", "info", "debug", "trace"]);

function normalizeLevel(raw, fallback = "info") {
  const value = String(raw === undefined || raw === null ? "" : raw).trim().toLowerCase();
  if (!value) return fallback;
  if (value === "warning") return "warn";
  if (value === "none" || value === "off") return "silent";
  return LEVELS.includes(value) ? value : fallback;
}

const inlineDestination = pino.destination({ dest: 1, sync: true, mkdir: false });

const root = pino(
  {
    level: normalizeLevel(process.env.LOG_LEVEL, "info"),
    base: { service: "factory-mes", pid: process.pid, hostname: os.hostname() },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  inlineDestination
);

function wrap(instance) {
  const api = {};
  for (const method of METHODS) {
    api[method] = (...args) => {
      // 级别关闭时连 util.format 都不做（debug/silent 场景下省掉格式化开销）
      if (!instance.isLevelEnabled(method)) return;
      instance[method](util.format(...args));
    };
  }
  Object.defineProperty(api, "level", { enumerable: true, get: () => instance.level });
  api.setLevel = (next) => {
    instance.level = normalizeLevel(next, instance.level);
    return instance.level;
  };
  api.isLevelEnabled = (level) => instance.isLevelEnabled(level);
  api.child = (bindings) => wrap(instance.child(bindings || {}));
  api.createLogger = (moduleName, extra) => wrap(instance.child({ module: moduleName, ...(extra || {}) }));
  // 需要真正的 (mergingObject, msg) 结构化调用时用这个，绕过 util.format 兼容层
  api.raw = instance;
  return api;
}

const logger = wrap(root);
// 顶层 createLogger 与实例上的 createLogger 都可用
logger.createLogger = (moduleName, extra) => wrap(root.child({ module: moduleName, ...(extra || {}) }));
logger.setLevel = (next) => {
  root.level = normalizeLevel(next, root.level);
  return root.level;
};
logger.normalizeLevel = normalizeLevel;
logger.LEVELS = LEVELS;

module.exports = logger;
module.exports.logger = logger;
module.exports.createLogger = logger.createLogger;
module.exports.normalizeLevel = normalizeLevel;
module.exports.LEVELS = LEVELS;
module.exports.default = logger;
