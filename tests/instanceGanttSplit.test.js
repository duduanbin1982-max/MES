"use strict";
// services/equipment/gantt/instanceGantt/ 拆分的回归守卫 (2026-10-11)
//
// 核心是 golden 对比：tests/fixtures/instanceGantt.golden.json 由**拆分前**的
// services/equipment/gantt/instanceGantt.js 跑出来，覆盖 7 种调用：
//   1 正常（含零时长节点） / 2 全未排程（走 fallback 排程） / 3 无节点（early return）
//   4 依赖链 + 环 / 5 工时缺失的三条兜底 / 999 与非法 id 的 404
//
// 表结构取自生产库导出（tests/fixtures/instanceGantt-tables.sql）。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "equipment", "gantt", "instanceGantt");
const { seedInstanceGanttDb } = require("./helpers/instanceGanttFixture");
const instanceGantt = require("../services/equipment/gantt/instanceGantt");

const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "tests", "fixtures", "instanceGantt.golden.json"), "utf8")
);

function call(instanceId) {
  const db = seedInstanceGanttDb();
  let captured = null;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      captured = { status: this.statusCode, body: payload };
      return this;
    },
  };
  try {
    instanceGantt.getInstanceGantt({ params: { id: String(instanceId) } }, res, db);
  } catch (error) {
    captured = { error: error.constructor.name + ": " + error.message };
  }
  db.close();
  return captured;
}

test("IGANTT.1 golden 对比：7 种调用的响应与拆分前逐字节一致", () => {
  const now = {
    instance1: call(1),
    instance2: call(2),
    instance3: call(3),
    instance4: call(4),
    instance5: call(5),
    missing: call(999),
    invalid: call("abc"),
  };
  for (const key of Object.keys(GOLDEN)) {
    assert.deepEqual(now[key], GOLDEN[key], `场景 ${key} 与 golden 不一致`);
  }
});

test("IGANTT.2 golden 样本有代表性（防假绿）", () => {
  assert.equal(GOLDEN.instance1.body.bars.length, 4);
  assert.equal(GOLDEN.instance3.body.bars.length, 0, "无节点分支必须覆盖");
  assert.ok(GOLDEN.instance3.body.total_days === 0);
  assert.equal(GOLDEN.instance2.body.dependency_count, 2, "fallback 排程要有依赖");
  assert.equal(GOLDEN.instance4.body.dependency_count, 3, "含环的依赖");
  assert.equal(GOLDEN.missing.status, 404);
  assert.equal(GOLDEN.invalid.status, 404);
  // 四种状态都应出现
  const statuses = new Set(
    [GOLDEN.instance1, GOLDEN.instance2, GOLDEN.instance5].flatMap((item) =>
      Object.keys(item.body.status_summary)
    )
  );
  assert.deepEqual([...statuses].sort(), ["completed", "in_progress", "pending"]);
});

test("IGANTT.3 公共面保留 getInstanceGantt，并暴露拆分后的内部件", () => {
  for (const name of ["getInstanceGantt", "nodeWorkHours", "buildFallbackScheduler"]) {
    assert.equal(typeof instanceGantt[name], "function", `missing export: ${name}`);
  }
  assert.equal(typeof instanceGantt.time.parseDate, "function");
  assert.equal(instanceGantt.time.HOURS_PER_WORKDAY, 8);
});

test("IGANTT.4 拆分目录里每个相对 require 都能解析", () => {
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const missing = [];
  for (const file of fs.readdirSync(MODULE_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = fs
      .readFileSync(path.join(MODULE_DIR, file), "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const match of source.matchAll(requirePattern)) {
      const request = match[1];
      if (!request.startsWith(".")) continue;
      const base = path.resolve(MODULE_DIR, request);
      const resolved = ["", ".js", ".json", "/index.js"].some((suffix) => fs.existsSync(`${base}${suffix}`));
      if (!resolved) missing.push(`${file}: ${request}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("IGANTT.5 nodeWorkHours 的三条兜底顺序不变", () => {
  const { nodeWorkHours } = instanceGantt;
  // 1) estimated_hours 优先
  assert.equal(nodeWorkHours({ estimated_hours: 12 }), 12);
  // 2) 其次用 planned 区间 —— 区间特意取 4 小时(不是 8),
  //    否则与第 3 条的 8 小时工作制同值, 断言无法区分两条兜底
  assert.equal(
    nodeWorkHours({ estimated_hours: 0, planned_start: "2026-10-09 08:00:00", planned_end: "2026-10-09 12:00:00" }),
    4
  );
  // 3) 最后回落 8 小时工作制
  assert.equal(nodeWorkHours({}), 8);
  assert.equal(nodeWorkHours({ estimated_hours: 0 }), 8);
  // planned_end <= planned_start 时也不该返回 0
  assert.equal(
    nodeWorkHours({ estimated_hours: 0, planned_start: "2026-10-09 08:00:00", planned_end: "2026-10-09 08:00:00" }),
    8
  );
});

test("IGANTT.6 buildFallbackScheduler 按前任结束时间推后继，且带环不卡死", () => {
  const db = seedInstanceGanttDb();
  const { buildFallbackScheduler, nodeWorkHours } = instanceGantt;
  const { parseDate } = instanceGantt.time;

  // instance 4: 401 -> 402 -> 403（外加 403 -> 402 的环）
  const instance4 = db
    .prepare("SELECT * FROM process_nodes WHERE equipment_instance_id = 4 ORDER BY id")
    .all();
  const deps4 = db
    .prepare("SELECT predecessor_id, successor_id FROM process_dependencies WHERE equipment_instance_id = 4")
    .all();
  const projectStart = parseDate("2026-10-08 08:00:00");
  const schedule = buildFallbackScheduler(instance4, deps4, projectStart);

  assert.equal(schedule.calcStart(401).toISOString(), projectStart.toISOString());
  assert.ok(schedule.calcStart(402) >= schedule.calcEnd(401), "402 不应早于 401 结束");
  assert.ok(schedule.calcStart(403) >= schedule.calcEnd(402), "403 不应早于 402 结束");
  // 环（403 -> 402）不能导致死循环：两次调用结果必须一致
  const first = schedule.calcStart(402).toISOString();
  const second = schedule.calcStart(402).toISOString();
  assert.equal(first, second);
  assert.ok(Number.isFinite(schedule.calcEnd(403).getTime()));

  // 已排程节点直接用自己的 planned_start/planned_end
  const instance1 = db.prepare("SELECT * FROM process_nodes WHERE equipment_instance_id = 1 ORDER BY id").all();
  const schedule1 = buildFallbackScheduler(instance1, [], parseDate("2026-10-01 08:00:00"));
  assert.equal(schedule1.calcStart(101).toISOString(), parseDate("2026-10-05 08:00:00").toISOString());
  assert.equal(schedule1.calcEnd(101).toISOString(), parseDate("2026-10-07 08:00:00").toISOString());
  // 未知节点回落到 projectStart
  assert.equal(schedule1.calcStart(99999).toISOString(), parseDate("2026-10-01 08:00:00").toISOString());
  assert.equal(nodeWorkHours(instance1[1]), 8);

  db.close();
});
