"use strict";
// services/delivery/readModel/index.js
// 交付读模型装配层（原 services/delivery/readModel.js，331 行）。
//
// 2026-10-11 拆分：4 个子读模型本来就是独立文件，本地只剩 helper 与聚合函数，
// 现按职责拆到 _helpers / _instances / _cost / _risk，本文件只做装配。
// 注意 require('../readModel') 解析到本目录的 index.js（同名 .js 已删除）。

const { createPurchaseFollowupReader } = require("./purchaseFollowups");
const { createExceptionReadModel } = require("./exceptions");
const { createProjectWorkflowReadModel } = require("./projectWorkflow");
const { createProjectLineageReadModel } = require("./projectLineage");
const { makeReadHelpers } = require("./_helpers");
const { makeInstanceReaders } = require("./_instances");
const { makeCostSummary } = require("./_cost");
const { makeRiskModel } = require("./_risk");

function createReadModel(ctx) {
  const helpers = makeReadHelpers(ctx);
  const { count, countByStatus, pct, severityRank, appendProjectQuery } = helpers;

  const purchaseFollowupReader = createPurchaseFollowupReader(ctx);
  const { purchaseFollowupPath, purchaseFollowupsForInstance } = purchaseFollowupReader;

  const instanceReaders = makeInstanceReaders(ctx);
  const { getInstances, oeeForInstance, instanceBudgetAmount } = instanceReaders;

  const costSummary = makeCostSummary(ctx, { instanceBudgetAmount });
  const { costSummaryForInstance } = costSummary;

  const riskModel = makeRiskModel(ctx, {
    severityRank,
    appendProjectQuery,
    purchaseFollowupPath,
    purchaseFollowupsForInstance,
    costSummaryForInstance,
  });
  const { riskBreakdownForProject, buildProjectRiskDrilldown } = riskModel;

  const exceptionReadModel = createExceptionReadModel(ctx, { getInstances, purchaseFollowupPath, severityRank });
  const { collectExceptions, exceptionSummary } = exceptionReadModel;

  const projectWorkflowReadModel = createProjectWorkflowReadModel(ctx, {
    count,
    countByStatus,
    pct,
    purchaseFollowupPath,
    purchaseFollowupsForInstance,
    costSummaryForInstance,
    riskBreakdownForProject,
    oeeForInstance,
  });
  const { buildProject } = projectWorkflowReadModel;

  const projectLineageReadModel = createProjectLineageReadModel(ctx, {
    pct,
    buildProject,
    costSummaryForInstance,
  });
  const { buildProjectLineage } = projectLineageReadModel;

  return {
    collectExceptions,
    exceptionSummary,
    getInstances,
    buildProject,
    buildProjectRiskDrilldown,
    buildProjectLineage,
  };
}

module.exports = { createReadModel };
