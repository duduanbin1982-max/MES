"use strict";
// tests/workloadBottleneck.test.js
// P2-1（2026-10-19）：排程页"最紧三个工位" —— Top3 瓶颈 / Top3 空闲的挑选逻辑。

const test = require("node:test");
const assert = require("node:assert/strict");

const { pickBottlenecks } = require("../services/equipment/gantt/resourcesGantt/_breakdown");

function row(over) {
  return {
    ws_id: 1, name: "WS", workshop: "下料",
    daily_capacity_hours: 8, total_busy_hours: 40,
    avg_utilization_pct: 50, peak_utilization_pct: 80, peak_day: "2026-10-20",
    ...over,
  };
}

test("WL.1 按峰值利用率排序，取前 3 个最紧工位", () => {
  const util = [
    row({ ws_id: 1, name: "激光切割", peak_utilization_pct: 120, avg_utilization_pct: 60 }),
    row({ ws_id: 2, name: "折弯卷制", peak_utilization_pct: 95, avg_utilization_pct: 50 }),
    row({ ws_id: 3, name: "焊接1", peak_utilization_pct: 140, avg_utilization_pct: 70 }),
    row({ ws_id: 4, name: "镗孔", peak_utilization_pct: 20, avg_utilization_pct: 10 }),
  ];
  const result = pickBottlenecks(util, 3);
  assert.deepEqual(result.top_overloaded.map((r) => r.name), ["焊接1", "激光切割", "折弯卷制"]);
  assert.equal(result.top_overloaded[0].peak_utilization_pct, 140);
  assert.equal(result.threshold.overload_pct, 100);
});

test("WL.2 峰值相同按平均利用率再按工时排序（稳定排序）", () => {
  const util = [
    row({ ws_id: 1, name: "A", peak_utilization_pct: 100, avg_utilization_pct: 50, total_busy_hours: 10 }),
    row({ ws_id: 2, name: "B", peak_utilization_pct: 100, avg_utilization_pct: 60, total_busy_hours: 10 }),
    row({ ws_id: 3, name: "C", peak_utilization_pct: 100, avg_utilization_pct: 60, total_busy_hours: 30 }),
  ];
  const order = pickBottlenecks(util, 3).top_overloaded.map((r) => r.name);
  assert.deepEqual(order, ["C", "B", "A"]);
});

test("WL.3 空闲榜只收峰值 < 30% 的工位", () => {
  const util = [
    row({ ws_id: 1, name: "忙碌", peak_utilization_pct: 120, avg_utilization_pct: 70 }),
    row({ ws_id: 2, name: "很空", peak_utilization_pct: 5, avg_utilization_pct: 2 }),
    row({ ws_id: 3, name: "较空", peak_utilization_pct: 29, avg_utilization_pct: 15 }),
    row({ ws_id: 4, name: "正常", peak_utilization_pct: 60, avg_utilization_pct: 40 }),
  ];
  const idle = pickBottlenecks(util, 3).top_idle.map((r) => r.name);
  assert.deepEqual(idle, ["很空", "较空"], "正常(60%) 不应进入空闲榜");
});

test("WL.4 空输入 / 无容量工位不会崩", () => {
  assert.deepEqual(pickBottlenecks([], 3).top_overloaded, []);
  assert.deepEqual(pickBottlenecks(null, 3).top_overloaded, []);
  const util = [row({ ws_id: 9, name: "未配容量", daily_capacity_hours: 0, peak_utilization_pct: 999 })];
  const result = pickBottlenecks(util, 3);
  assert.deepEqual(result.top_overloaded, [], "容量为 0 的工位不参与排名（避免除零/误报）");
});

test("WL.5 返回字段精炼（供前端卡片直接用）", () => {
  const result = pickBottlenecks([row({ ws_id: 7, name: "焊接2", peak_utilization_pct: 110 })], 3);
  const item = result.top_overloaded[0];
  assert.deepEqual(Object.keys(item).sort(), [
    "avg_utilization_pct", "daily_capacity_hours", "name", "peak_day",
    "peak_utilization_pct", "total_busy_hours", "workshop", "ws_id",
  ].sort());
  assert.equal(item.ws_id, 7);
});
