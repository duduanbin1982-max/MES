"use strict";
// services/delivery/readModel/ 拆分的回归守卫 (2026-10-11)
//
// 核心用例是 golden 对比：tests/fixtures/deliveryReadModel.golden.json 是拆分前
// 用原实现（services/delivery/readModel.js）跑出来的全部公共 API 输出，
// 数据来自 tests/helpers/deliveryReadModelFixture.js（表结构取自生产库导出）。
//
// 唯一的归一化：异常文案里的"已延期 N 天"随墙上时钟漂移，统一替换为占位符；
// 其余字段全部逐字节比对。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(PROJECT_ROOT, "services", "delivery", "readModel");
const { seedDeliveryDb, normalizeGolden } = require("./helpers/deliveryReadModelFixture");
const { createDeliveryDbContext } = require("../services/delivery/dbContext");
const { createReadModel } = require("../services/delivery/readModel");

const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "tests", "fixtures", "deliveryReadModel.golden.json"), "utf8")
);

function attempt(run) {
  try {
    return { ok: run() };
  } catch (error) {
    return { error: error.constructor.name + ": " + error.message };
  }
}

function snapshot() {
  const db = seedDeliveryDb();
  const ctx = createDeliveryDbContext(db);
  const model = createReadModel({ db, ...ctx, enrichEscalation: (item) => item });

  const exceptions = model.collectExceptions();
  const instances = model.getInstances();

  const out = {
    instances,
    exception_count: exceptions.length,
    exceptions,
    exception_summary: attempt(() => model.exceptionSummary(exceptions)),
    projects: instances.map((instance) => attempt(() => model.buildProject(instance, exceptions))),
    drilldowns: instances.map((instance) => attempt(() => model.buildProjectRiskDrilldown(instance, exceptions))),
    lineages: instances.map((instance) => attempt(() => model.buildProjectLineage(instance, exceptions))),
  };
  db.close();
  return normalizeGolden(out);
}

test("DELIV.1 golden 对比：拆分后全部公共 API 输出与拆分前一致", () => {
  const now = snapshot();
  for (const key of Object.keys(GOLDEN)) {
    assert.deepEqual(now[key], GOLDEN[key], `section ${key} 与 golden 不一致`);
  }
});

test("DELIV.2 golden 样本本身足够有代表性（防假绿）", () => {
  assert.equal(GOLDEN.instances.length, 3);
  assert.ok(GOLDEN.exception_count >= 3, "异常样本太少");
  assert.equal(GOLDEN.exception_summary.ok.total, GOLDEN.exception_count);
  // 三条成本分支都应被覆盖
  const riskLevels = GOLDEN.drilldowns.map((item) => item.ok.cost.risk_level);
  assert.ok(riskLevels.includes("critical"), "缺少 critical 成本风险样本");
  assert.ok(GOLDEN.drilldowns.some((item) => item.ok.shortages.length > 0), "缺少缺料样本");
  assert.ok(GOLDEN.drilldowns.some((item) => item.ok.ncrs.length > 0), "缺少 NCR 样本");
  assert.ok(GOLDEN.drilldowns.some((item) => item.ok.purchase_followups.length > 0), "缺少采购跟催样本");
  assert.ok(GOLDEN.projects.every((item) => item.ok && item.ok.stages.length > 0), "项目工作流阶段缺失");
});

test("DELIV.3 公共面仍是 6 个函数，且与 routes.js 解构的名字一致", () => {
  const db = seedDeliveryDb();
  const ctx = createDeliveryDbContext(db);
  const model = createReadModel({ db, ...ctx, enrichEscalation: (item) => item });
  assert.deepEqual(
    Object.keys(model).sort(),
    ["buildProject", "buildProjectLineage", "buildProjectRiskDrilldown", "collectExceptions", "exceptionSummary", "getInstances"]
  );
  for (const name of Object.keys(model)) assert.equal(typeof model[name], "function", name);
  db.close();
});

test("DELIV.4 拆分目录里每个相对 require 都能解析", () => {
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const missing = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const source = fs
        .readFileSync(full, "utf8")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
        })
        .join("\n");
      for (const match of source.matchAll(requirePattern)) {
        const request = match[1];
        if (!request.startsWith(".")) continue;
        const base = path.resolve(path.dirname(full), request);
        const resolved = ["", ".js", ".json", "/index.js"].some((suffix) => fs.existsSync(`${base}${suffix}`));
        if (!resolved) missing.push(`${path.relative(MODULE_DIR, full)}: ${request}`);
      }
    }
  };
  walk(MODULE_DIR);
  assert.deepEqual(missing, []);
});

test("DELIV.5 拆分出的工厂函数可单独使用，行为与装配层一致", () => {
  const { makeReadHelpers } = require("../services/delivery/readModel/_helpers");
  const { makeInstanceReaders } = require("../services/delivery/readModel/_instances");
  const { makeCostSummary } = require("../services/delivery/readModel/_cost");
  const { makeRiskModel } = require("../services/delivery/readModel/_risk");

  const db = seedDeliveryDb();
  const ctx = createDeliveryDbContext(db);
  const helpers = makeReadHelpers(ctx);
  assert.equal(helpers.pct(1, 4), 25);
  assert.equal(helpers.pct(0, 0), 0);
  assert.equal(helpers.severityRank("critical"), 4);
  assert.equal(helpers.severityRank("nope"), 0);
  assert.equal(
    helpers.appendProjectQuery("/delivery", 7, { segment: "kit" }),
    "/delivery?instance_id=7&from=delivery&segment=kit"
  );

  const readers = makeInstanceReaders(ctx);
  const instances = readers.getInstances();
  assert.equal(instances.length, GOLDEN.instances.length);
  assert.equal(readers.instanceBudgetAmount({ contract_amount: 100, contract_amount_unit: "wan" }), 1000000);
  assert.equal(readers.instanceBudgetAmount({ contract_amount: 500000, contract_amount_unit: "yuan" }), 500000);
  assert.equal(readers.oeeForInstance(999), null);

  const { costSummaryForInstance } = makeCostSummary(ctx, { instanceBudgetAmount: readers.instanceBudgetAmount });
  const instance1 = instances.find((item) => Number(item.id) === 1);
  const cost = costSummaryForInstance(instance1);
  assert.equal(cost.source, "project_cost_entries");
  assert.equal(cost.risk_level, "critical");
  assert.equal(cost.variance_pct, 60);

  const risk = makeRiskModel(ctx, {
    severityRank: helpers.severityRank,
    appendProjectQuery: helpers.appendProjectQuery,
    purchaseFollowupPath: (id) => `/purchase?tab=followup&instance_id=${id}`,
    purchaseFollowupsForInstance: () => [],
    costSummaryForInstance,
  });
  const breakdown = risk.riskBreakdownForProject(instance1, []);
  // 没有跟催时, 成本 critical(4) 记 4 分 -> warning 档
  assert.equal(breakdown.score, 4);
  assert.equal(breakdown.risk_level, "warning");
  assert.ok(breakdown.quick_actions.some((action) => action.type === "cost_variance"));
  db.close();
});
