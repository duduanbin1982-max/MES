"use strict";
// tests/logger.test.js
// 统一 logger (app/logger.js, pino) 的行为回归 (2026-10-11, 静态分析 v1 #3)
//
// 断言方式说明:
//   app/logger.js 用 pino 的同步目标直接写 fd 1(fs.writeSync)，
//   在进程内 monkey-patch console.log / process.stdout.write 都拦不到，
//   所以凡是要看真实输出的用例都在子进程里跑再解析 stdout。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const logger = require("../app/logger");

function runChildRaw(source, env) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `child failed: ${result.stderr}`);
  return {
    stderr: result.stderr,
    lines: result.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line)),
  };
}

function runInChild(source, env) {
  return runChildRaw(source, env).lines;
}

test("LOG.1 normalizeLevel 接受常见写法并回落 info", () => {
  assert.equal(logger.normalizeLevel("debug"), "debug");
  assert.equal(logger.normalizeLevel(" DEBUG "), "debug");
  assert.equal(logger.normalizeLevel("warning"), "warn");
  assert.equal(logger.normalizeLevel("off"), "silent");
  assert.equal(logger.normalizeLevel("none"), "silent");
  assert.equal(logger.normalizeLevel(""), "info");
  assert.equal(logger.normalizeLevel(undefined), "info");
  assert.equal(logger.normalizeLevel(null), "info");
  assert.equal(logger.normalizeLevel("bogus"), "info");
  assert.equal(logger.normalizeLevel("bogus", "warn"), "warn");
});

test("LOG.2 默认 info 级别：info/warn/error 输出，debug/trace 被抑制", () => {
  const lines = runInChild(
    [
      'const logger = require("./app/logger").createLogger("t");',
      'logger.trace("TRACE_LINE");',
      'logger.debug("DEBUG_LINE");',
      'logger.info("INFO_LINE");',
      'logger.warn("WARN_LINE");',
      'logger.error("ERROR_LINE");',
    ].join("\n"),
    { LOG_LEVEL: "info" }
  );
  assert.deepEqual(
    lines.map((line) => line.msg),
    ["INFO_LINE", "WARN_LINE", "ERROR_LINE"]
  );
});

test("LOG.3 LOG_LEVEL=debug 打开 debug，LOG_LEVEL=silent 全静默", () => {
  const debugLines = runInChild(
    'const logger = require("./app/logger"); logger.debug("DEBUG_LINE"); logger.info("INFO_LINE");',
    { LOG_LEVEL: "debug" }
  );
  assert.deepEqual(
    debugLines.map((line) => line.msg),
    ["DEBUG_LINE", "INFO_LINE"]
  );

  const silentLines = runInChild(
    'const logger = require("./app/logger"); logger.fatal("NOPE"); logger.info("NOPE");',
    { LOG_LEVEL: "silent" }
  );
  assert.deepEqual(silentLines, []);
});

test("LOG.4 每行都是合法 JSON，且带 level/time/service/module/msg", () => {
  const lines = runInChild(
    'const logger = require("./app/logger").createLogger("iotCollector"); logger.info("[iotCollector] hello %s", "world");',
    { LOG_LEVEL: "info" }
  );
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.level, "info");
  assert.equal(line.service, "factory-mes");
  assert.equal(line.module, "iotCollector");
  assert.equal(line.msg, "[iotCollector] hello world");
  assert.match(line.time, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Number.isInteger(line.pid));
  assert.equal(typeof line.hostname, "string");
});

test("LOG.5 msg 与 console.log 的 util.format 结果逐字一致（多参数不丢信息）", () => {
  // 与 console.* 同规则：多参数合并成一条 msg，格式串/%s/%d 行为不变
  const casesSource = `[
    ["plain", 1, { nested: { a: [1, 2] } }],
    ["fmt %s and %d", "s", 7],
    [null, undefined, true],
    [["arr"], "tail"],
    ["100%"],
    ["%s %s", "only-one"],
    []
  ]`;
  const cases = new Function(`return ${casesSource}`)();
  const expected = cases.map((args) => util.format(...args));

  const actual = runInChild(
    `const logger = require("./app/logger"); const cases = ${casesSource}; for (const args of cases) logger.info(...args);`,
    { LOG_LEVEL: "info" }
  ).map((line) => line.msg);

  assert.deepEqual(actual, expected);
});

test("LOG.6 createLogger 固定 module；不带 module 时保留原有 [tag] 文本", () => {
  const lines = runInChild(
    [
      'const logger = require("./app/logger");',
      'logger.info("[auth] 已加载 3 个角色权限");',
      'const child = logger.createLogger("spcMonitor");',
      'child.info("[spcMonitor] Stopped");',
      'child.child({ device: 7 }).info("nested child");',
    ].join("\n"),
    { LOG_LEVEL: "info" }
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[0].module, undefined);
  assert.equal(lines[0].msg, "[auth] 已加载 3 个角色权限");
  assert.equal(lines[1].module, "spcMonitor");
  assert.equal(lines[1].msg, "[spcMonitor] Stopped");
  assert.equal(lines[2].module, "spcMonitor");
  assert.equal(lines[2].device, 7);
});

test("LOG.7 setLevel 运行时生效，且级别关闭时不做格式化", () => {
  const result = runChildRaw(
    [
      'const logger = require("./app/logger");',
      'const util = require("node:util");',
      'let calls = 0;',
      'const real = util.format;',
      'util.format = (...a) => { calls += 1; return real(...a); };',
      'logger.setLevel("info");',
      'logger.debug("hidden %s", "x");',
      'logger.setLevel("debug");',
      'logger.debug("shown %s", "x");',
      'process.stderr.write("###FORMAT_CALLS=" + calls + "\\n");',
    ].join("\n"),
    { LOG_LEVEL: "info" }
  );
  assert.deepEqual(
    result.lines.map((line) => line.msg),
    ["shown x"]
  );
  // info 级别下那条 debug 连 util.format 都不该走
  assert.match(result.stderr, /###FORMAT_CALLS=1\b/);
});

test("LOG.8 后端目录不再直接使用 console.*（统一日志出口）", () => {
  const BACKEND_DIRS = ["services", "routes", "app", "db", "middleware", "utils"];
  // 目前没有豁免；将来确有必要时应在此登记并写明原因
  const ALLOWED = new Set();

  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
      return entry.name.endsWith(".js") ? [full] : [];
    });

  const offenders = [];
  for (const directory of BACKEND_DIRS) {
    const root = path.join(PROJECT_ROOT, directory);
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const relative = path.relative(PROJECT_ROOT, file).split(path.sep).join("/");
      if (ALLOWED.has(relative)) continue;
      const code = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
        })
        .join("\n");
      if (/console\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/.test(code)) offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], "这些文件应改用 require(...).createLogger(...)，见 app/logger.js");
});

test("LOG.9 后端每个模块拿到的是同一个底层 pino 实例（不会被重复初始化）", () => {
  const a = require("../app/logger");
  const b = require("../app/logger");
  assert.equal(a, b);
  assert.equal(a.raw, b.raw);
  assert.equal(typeof a.raw.info, "function");
});
