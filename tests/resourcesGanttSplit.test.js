"use strict";
// services/equipment/gantt/resourcesGantt/ 拆分的回归守卫 (2026-10-11)
//
// 这个文件原本是一个 244 行的单函数，拆分时把它按 8 个阶段拆开，
// 有真实的行为改变风险。因此核心用例是 **golden 对比**：
// tests/fixtures/resourcesGantt.golden.json 是拆分前用原实现跑出来的响应
// （三种查询：无过滤 / instance_id=1 / 默认 days），
// 拆分后必须与它 deep-equal。fixture 由 .tmp/capture-gantt-golden.js 生成。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "equipment", "gantt", "resourcesGantt");
const { seedGanttDb } = require("./helpers/resourcesGanttFixture");
const resourcesGantt = require("../services/equipment/gantt/resourcesGantt");

const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "tests", "fixtures", "resourcesGantt.golden.json"), "utf8")
);

function capture(query) {
  const db = seedGanttDb();
  let payload = null;
  resourcesGantt.getResourcesGantt({ query }, { json: (body) => { payload = body; } }, db);
  db.close();
  return payload;
}

test("GANTT.1 golden 对比：拆分后响应与拆分前逐字节一致", () => {
  const scenarios = {
    unfiltered: { start_date: "2026-10-12", days: "7" },
    filtered: { start_date: "2026-10-12", days: "7", instance_id: "1", compare: "1" },
    defaultDays: { start_date: "2026-10-12" },
  };
  for (const [name, query] of Object.entries(scenarios)) {
    assert.deepEqual(capture(query), GOLDEN[name], `场景 ${name} 的响应与 golden 不一致`);
  }
  // golden 本身要有内容，否则这条用例会假绿
  assert.ok(GOLDEN.unfiltered.items.length >= 5, "golden 样本太少");
  assert.ok(GOLDEN.unfiltered.conflicts.length >= 2, "golden 里应包含冲突样本");
  assert.equal(GOLDEN.defaultDays.num_days, 30);
});

test("GANTT.2 公共面保留 getResourcesGantt，并暴露拆分后的阶段函数", () => {
  const names = [
    "getResourcesGantt",
    "resolveWindow",
    "loadSourceRows",
    "collectItems",
    "loadWorkstations",
    "buildHeatmap",
    "buildInstanceBreakdown",
    "buildWorkstationUtilization",
    "detectConflicts",
  ];
  for (const name of names) {
    assert.equal(typeof resourcesGantt[name], "function", `missing export: ${name}`);
  }
});

test("GANTT.3 拆分目录里每个相对 require 都能解析", () => {
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

test("GANTT.4 resolveWindow 的钳制与默认值不变", () => {
  assert.equal(resourcesGantt.resolveWindow({ start_date: "2026-10-12", days: "1000" }).numDays, 180);
  assert.equal(resourcesGantt.resolveWindow({ start_date: "2026-10-12", days: "1" }).numDays, 1);
  assert.equal(resourcesGantt.resolveWindow({ start_date: "2026-10-12" }).numDays, 30);
  const filtered = resourcesGantt.resolveWindow({ start_date: "2026-10-12", instance_id: "7" });
  assert.equal(filtered.instanceFilter, 7);
  assert.equal(filtered.rangeStart.getHours(), 0);
  assert.equal(resourcesGantt.resolveWindow({ start_date: "2026-10-12", compare: "1" }).compare, "1");
});

test("GANTT.5 workstationDailyCapacity 按班次 × 人数推导（P2-1 口径修正，2026-10-19）", () => {
  // 原实现：capacity_per_day × 8 —— 把"件/天产能"当成了工时容量（50 件/天 → 400 小时/天），
  // 导致利用率被稀释 10~50 倍，"最紧工位"看不出来。现改为「班次工时 × max_workers，封顶 24h」，
  // capacity_per_day 仅作"件/天产能"参考，不再参与工时计算。
  assert.equal(resourcesGantt.workstationDailyCapacity({}), 8, "默认白班 8h");
  assert.equal(resourcesGantt.workstationDailyCapacity({ max_workers: 3 }), 24, "8h × 3 人");
  assert.equal(resourcesGantt.workstationDailyCapacity({ shift: "two" }), 16, "双班 16h");
  assert.equal(resourcesGantt.workstationDailyCapacity({ shift: "three", max_workers: 2 }), 24, "24h × 2 封顶 24");
  assert.equal(resourcesGantt.workstationDailyCapacity({ capacity_per_day: 50, max_workers: 1 }), 8, "件/天产能不再影响工时容量");
});

test("GANTT.6 每个阶段函数可独立调用，且与 golden 的分片一致", () => {
  const db = seedGanttDb();
  const { rangeStart, numDays, rangeEnd, instanceFilter } = resourcesGantt.resolveWindow({
    start_date: "2026-10-12",
    days: "7",
  });
  const { workOrders, processNodes } = resourcesGantt.loadSourceRows(db, instanceFilter);
  // WO-4 既无 planned_start 也无 actual_start，被 SQL 的 NULL 过滤掉（剩下 1/2/3/5）；
  // PN-4 虽有 planned_start 但在窗口之外，留给 collectItems 过滤。
  assert.equal(workOrders.length, 4);
  assert.equal(processNodes.length, 4);

  const items = resourcesGantt.collectItems(workOrders, processNodes, rangeStart, rangeEnd);
  assert.equal(items.length, GOLDEN.unfiltered.items.length, "窗口过滤后的条目数应与 golden 一致");

  const workstations = resourcesGantt.loadWorkstations(db);
  assert.equal(workstations.length, GOLDEN.unfiltered.workstations.length, "停用工位应被过滤");

  const { workstationById, dayList, heatmapGrid } = resourcesGantt.buildHeatmap(workstations, items, rangeStart, numDays);
  assert.equal(dayList.length, numDays);
  assert.equal(workstationById.size, workstations.length);

  assert.deepEqual(
    resourcesGantt.buildInstanceBreakdown(items),
    GOLDEN.unfiltered.instance_breakdown
  );
  assert.deepEqual(
    resourcesGantt.buildWorkstationUtilization(heatmapGrid),
    GOLDEN.unfiltered.workstation_utilization
  );
  assert.deepEqual(
    resourcesGantt.detectConflicts(items, heatmapGrid, workstationById),
    GOLDEN.unfiltered.conflicts
  );
  db.close();
});
