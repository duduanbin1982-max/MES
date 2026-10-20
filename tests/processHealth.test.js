"use strict";
// tests/processHealth.test.js
// 2026-10-19：全流程健康检查 —— 8 个环节的状态判定 + 总分/下一步动作。

const test = require("node:test");
const assert = require("node:assert/strict");

const { STAGES, metric, evaluateStage, summarize } = require("../app/processHealth");

function metrics(pairs) {
  return Object.entries(pairs).map(([key, value]) => metric(key, key, value));
}

test("PH.1 定义覆盖 8 个环节且都有页面与动作", () => {
  assert.equal(STAGES.length, 8);
  for (const stage of STAGES) {
    assert.ok(stage.key && stage.label, "缺 key/label");
    assert.ok(stage.page && stage.page.startsWith("/"), stage.key + " 缺 page");
    assert.ok(stage.action.length > 4, stage.key + " 缺 action");
  }
});

test("PH.2 项目与里程碑：无里程碑=empty，有里程碑无合同=partial，都齐=ok", () => {
  assert.equal(evaluateStage("project", metrics({ milestones: 0, contract: 0 })).status, "empty");
  assert.equal(evaluateStage("project", metrics({ milestones: 10, contract: 0 })).status, "partial");
  assert.equal(evaluateStage("project", metrics({ milestones: 10, contract: 1 })).status, "ok");
});

test("PH.3 BOM：有行无料=partial，有料无批次=partial，批次覆盖≥80% 才 ok", () => {
  const noMaterial = evaluateStage("design_bom", metrics({ bom_rows: 79, bom_with_material: 0, bom_with_lot: 0 }));
  assert.equal(noMaterial.status, "partial");
  assert.ok(noMaterial.blockers.some((b) => /没有挂物料/.test(b)));
  const withMaterial = evaluateStage("design_bom", metrics({ bom_rows: 79, bom_with_material: 40, bom_with_lot: 0 }));
  assert.equal(withMaterial.status, "partial");
  assert.ok(withMaterial.blockers.some((b) => /实装批次/.test(b)));
  // 8/40 = 20% 覆盖率 → 仍是 partial（P2-2 量差需要批次）
  assert.equal(evaluateStage("design_bom", metrics({ bom_rows: 79, bom_with_material: 40, bom_with_lot: 8 })).status, "partial");
  assert.equal(evaluateStage("design_bom", metrics({ bom_rows: 79, bom_with_material: 40, bom_with_lot: 32 })).status, "ok");
});

test("PH.4 工艺：排程覆盖 < 80% 判 partial 并给出百分比", () => {
  const partial = evaluateStage("process", metrics({ nodes: 170, nodes_scheduled: 131, nodes_with_workstation: 170 }));
  assert.equal(partial.status, "partial");
  assert.ok(partial.blockers.some((b) => /77\.1%/.test(b)), "应给出覆盖率: " + JSON.stringify(partial.blockers));
  assert.equal(evaluateStage("process", metrics({ nodes: 170, nodes_scheduled: 170, nodes_with_workstation: 170 })).status, "ok");
});

test("PH.5 派工与报工：无报工工时 → partial + 明确提示", () => {
  const stage = evaluateStage("execution", metrics({ work_orders: 4, work_orders_with_workstation: 3, operations_with_hours: 0 }));
  assert.equal(stage.status, "partial");
  assert.ok(stage.blockers.some((b) => /报工/.test(b)));
});

test("PH.6 检验：有焊缝无 NDT → partial；有检验+NDT → ok", () => {
  const partial = evaluateStage("quality", metrics({ inspections: 3, work_order_qc: 0, welds: 4, ndt: 0, assembly: 0 }));
  assert.equal(partial.status, "partial");
  assert.ok(partial.blockers.some((b) => /NDT/.test(b)));
  assert.equal(evaluateStage("quality", metrics({ inspections: 3, work_order_qc: 0, welds: 4, ndt: 1, assembly: 0 })).status, "ok");
});

test("PH.7 summarize：总分 = 各环节均分；next_actions 取未完成前 3 个", () => {
  const stages = [
    evaluateStage("project", metrics({ milestones: 10, contract: 1 })),      // ok 100
    evaluateStage("design_bom", metrics({ bom_rows: 79, bom_with_material: 40, bom_with_lot: 32 })), // ok 100
    evaluateStage("process", metrics({ nodes: 10, nodes_scheduled: 10, nodes_with_workstation: 10 })), // ok 100
    evaluateStage("execution", metrics({ work_orders: 4, work_orders_with_workstation: 3, operations_with_hours: 0 })), // partial 50
    evaluateStage("material", metrics({ lots: 9, issue_movements: 0, serials: 0 })), // partial 50
    evaluateStage("quality", metrics({ inspections: 0, work_order_qc: 0, welds: 0, ndt: 0, assembly: 0 })), // empty 0
    evaluateStage("documents", metrics({ documents: 0 })), // empty 0
    evaluateStage("delivery_cost", metrics({ delivery_milestones: 2, cost_entries: 0, cost_types: 0 })), // partial 50
  ];
  const summary = summarize(stages);
  assert.equal(summary.counts.ok, 3);
  assert.equal(summary.counts.partial, 3);
  assert.equal(summary.counts.empty, 2);
  // 2026-10-20：部分环节按完成度计分（50~99），总分改为按实际 stage 分数求平均
  const expected = Math.round((stages.reduce((sum, stage) => sum + stage.score, 0) / stages.length) * 10) / 10;
  assert.equal(summary.score, expected);
  assert.ok(summary.score > 50, "部分环节有进展时总分应高于粗档位 50");
  assert.deepEqual(summary.next_actions.map((a) => a.stage), ["派工与报工", "齐套与领料", "检验与证据"]);
  assert.ok(summary.next_actions[0].action.length > 4);
});

test("PH.8 空输入不崩：score=0 / grade=blocked / 无动作", () => {
  const summary = summarize([]);
  assert.equal(summary.score, 0);
  assert.equal(summary.grade, "blocked");
  assert.deepEqual(summary.next_actions, []);
});

test("PH.9 派工与报工：报工覆盖不足（1/3）→ partial，覆盖满才 ok", () => {
  const partial = evaluateStage("execution", metrics({ work_orders: 3, work_orders_with_workstation: 2, operations_with_hours: 1 }));
  assert.equal(partial.status, "partial");
  assert.ok(partial.blockers.some((b) => /1\/3/.test(b)));
  assert.equal(evaluateStage("execution", metrics({ work_orders: 3, work_orders_with_workstation: 3, operations_with_hours: 3 })).status, "ok");
});

test("PH.10 交付与成本：只有一类成本（仅人工）→ partial，≥2 类才 ok", () => {
  const partial = evaluateStage("delivery_cost", metrics({ delivery_milestones: 1, cost_entries: 3, cost_types: 1 }));
  assert.equal(partial.status, "partial");
  assert.ok(partial.blockers.some((b) => /1 类/.test(b)));
  assert.equal(evaluateStage("delivery_cost", metrics({ delivery_milestones: 1, cost_entries: 5, cost_types: 2 })).status, "ok");
});

test("PH.11 部分环节按完成度计分：覆盖率越高分数越高，但不到 100", () => {
  const low = evaluateStage("design_bom", metrics({ bom_rows: 68, bom_with_material: 40, bom_with_lot: 8 }));
  const mid = evaluateStage("design_bom", metrics({ bom_rows: 68, bom_with_material: 40, bom_with_lot: 20 }));
  const high = evaluateStage("design_bom", metrics({ bom_rows: 68, bom_with_material: 40, bom_with_lot: 31 }));
  assert.equal(low.status, "partial");
  assert.equal(mid.status, "partial");
  assert.equal(high.status, "partial");
  assert.ok(mid.score > low.score, `${mid.score} 应大于 ${low.score}`);
  assert.ok(high.score > mid.score, `${high.score} 应大于 ${mid.score}`);
  assert.ok(high.score < 100, "未跨过 80% 阈值不能给满分");
  assert.equal(low.progress_pct, 20);
  assert.equal(mid.progress_pct, 50);
  assert.equal(evaluateStage("design_bom", metrics({ bom_rows: 68, bom_with_material: 40, bom_with_lot: 32 })).score, 100);
});

test("PH.12 新建空实例：BOM 已挂批次=0、无领料/序列号 → 齐套环节 empty（不再误判 partial）", () => {
  const stage = evaluateStage("material", metrics({ lots: 0, issue_movements: 0, serials: 0 }));
  assert.equal(stage.status, "empty");
  assert.equal(stage.score, 0);
  assert.ok(stage.blockers.some((b) => /批次/.test(b)));
});
