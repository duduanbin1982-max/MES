"use strict";
// app/oee/engine.js
// P1 OEE 深度分析引擎
//   OEE = Availability × Performance × Quality
//   六大损失: 故障/换型/空转/速度降/废品/返工
// Author: 三狗子 | Date: 2026-06-26
//
// ⚠️  @deprecated 2026-07-11 (brooks-audit R4 决策 ADR-003)
//   0 外部 require (services/oee/* 自己定义 store, 不引这里)
//   0 注册到 routes (register-all.js 不调用 services/oeeService.js)
//   实际 OEE 业务跑在 services/oee/ (7 个文件, store + routes + migration)
//   保留: 历史快照 / 复盘参考
//   未来: Phase 2 cleanup 时评估删除

/**
 * @typedef {Object} OEEInput
 * @property {number} plannedProductionTime - 计划生产时间 (分钟)
 * @property {number} operatingTime - 实际运行时间 (分钟)
 * @property {number} downtimeBreakdown - 故障停机时间 (分钟)
 * @property {number} downtimeSetup - 换型调试时间 (分钟)
 * @property {number} idealCycleTime - 理论节拍 (分钟/件)
 * @property {number} totalOutput - 总产出件数
 * @property {number} goodOutput - 合格品件数
 * @property {number} reducedSpeedLoss - 速度损失 (分钟)
 * @property {number} minorStopLoss - 小停机损失 (分钟)
 */

/**
 * 计算 OEE 核心指标
 */
function calculate(input) {
  const {
    plannedProductionTime = 0,
    operatingTime = 0,
    downtimeBreakdown = 0,
    downtimeSetup = 0,
    idealCycleTime = 0,
    totalOutput = 0,
    goodOutput = 0,
    reducedSpeedLoss = 0,
    minorStopLoss = 0,
  } = input;

  if (plannedProductionTime <= 0) return emptyResult();

  // Availability = OperatingTime / PlannedProductionTime
  const availability = Math.min(1, Math.max(0, operatingTime / plannedProductionTime));

  // Performance = (IdealCycleTime × TotalOutput) / OperatingTime
  const performance = operatingTime > 0 && idealCycleTime > 0
    ? Math.min(1, Math.max(0, (idealCycleTime * totalOutput) / operatingTime))
    : 0;

  // Quality = GoodOutput / TotalOutput
  const quality = totalOutput > 0 ? Math.min(1, Math.max(0, goodOutput / totalOutput)) : 1;

  // OEE
  const oee = availability * performance * quality;

  // 六大损失
  const breakdownPct = plannedProductionTime > 0 ? downtimeBreakdown / plannedProductionTime : 0;
  const setupPct = plannedProductionTime > 0 ? downtimeSetup / plannedProductionTime : 0;
  const speedPct = operatingTime > 0 ? reducedSpeedLoss / operatingTime : 0;
  const minorStopPct = operatingTime > 0 ? minorStopLoss / operatingTime : 0;
  const scrapPct = totalOutput > 0 ? (totalOutput - goodOutput) / totalOutput : 0;

  return {
    availability: round(availability),
    performance: round(performance),
    quality: round(quality),
    oee: round(oee),
    grade: oeeGrade(oee),

    losses: {
      breakdown: { name: "故障停机", minutes: downtimeBreakdown, pct: round(breakdownPct) },
      setup:     { name: "换型调试", minutes: downtimeSetup,     pct: round(setupPct) },
      minorStop: { name: "小停机",   minutes: minorStopLoss,     pct: round(minorStopPct) },
      speed:     { name: "速度降低", minutes: reducedSpeedLoss,  pct: round(speedPct) },
      scrap:     { name: "废品/返工",minutes: 0,                 pct: round(scrapPct), units: totalOutput - goodOutput },
      startup:   { name: "启动损失", minutes: 0,                 pct: 0 },
    },

    // 前三大损失
    topLosses: getTopLosses({ breakdownPct, setupPct, speedPct, minorStopPct, scrapPct }),
  };
}

/**
 * 从数据库记录构建 OEE 输入
 * @param {Array} workOrders - 工单列表 (含 planned_start/end, actual_start/end, estimated_hours)
 * @param {Array} operations - 工序执行记录 (含 action/timestamp/hours_worked)
 * @param {Array} qcResults - 质检结果
 */
function buildInput(workOrders, operations, qcResults) {
  let plannedMin = 0;
  let actualMin = 0;
  let downtimeBreakdown = 0;
  let downtimeSetup = 0;
  let goodOutput = 0;
  let totalOutput = 0;
  let idealMinutes = 0;

  for (const wo of workOrders) {
    if (!wo) continue;
    // 计划时间 = estimated_hours × 60
    if (wo.estimated_hours) plannedMin += wo.estimated_hours * 60;

    // 实际时间 = (actual_end - actual_start) if both exist
    if (wo.actual_start && wo.actual_end) {
      const dur = (new Date(wo.actual_end) - new Date(wo.actual_start)) / 60000;
      if (dur > 0) actualMin += dur;
    }

    // 理论时间 = estimated_hours × 60 as proxy for ideal cycle
    if (wo.estimated_hours && wo.status === "completed") idealMinutes += wo.estimated_hours * 60;
  }

  // 从工序执行记录提取损失
  for (const op of operations || []) {
    if (!op) continue;
    if (op.action === "pause") downtimeBreakdown += (op.hours_worked || 0) * 60;
    if (op.action === "start" && op.notes && op.notes.includes("换型")) downtimeSetup += (op.hours_worked || 0) * 60;
  }

  // 质检
  for (const qc of qcResults || []) {
    if (!qc) continue;
    totalOutput++;
    if (qc.result === "pass") goodOutput++;
  }

  return {
    plannedProductionTime: plannedMin,
    operatingTime: Math.max(0, actualMin - downtimeBreakdown - downtimeSetup),
    downtimeBreakdown,
    downtimeSetup,
    idealCycleTime: totalOutput > 0 && idealMinutes > 0 ? idealMinutes / totalOutput : 0,
    totalOutput,
    goodOutput,
    reducedSpeedLoss: Math.max(0, plannedMin - actualMin - downtimeBreakdown - downtimeSetup),
    minorStopLoss: 0,
  };
}

/**
 * 时间序列 OEE (按天/周/月聚合)
 */
function trendSeries(workOrders, qcResults, granularity) {
  const daily = {};

  for (const wo of workOrders || []) {
    if (!wo || !wo.actual_start) continue;
    const date = wo.actual_start.slice(0, granularity === "month" ? 7 : 10);
    if (!daily[date]) daily[date] = { planned: 0, actual: 0, good: 0, total: 0, count: 0 };
    daily[date].planned += (wo.estimated_hours || 0) * 60;
    if (wo.actual_start && wo.actual_end) {
      daily[date].actual += Math.max(0, (new Date(wo.actual_end) - new Date(wo.actual_start)) / 60000);
    }
    daily[date].count++;
  }

  for (const qc of qcResults || []) {
    if (!qc || !qc.inspection_date) continue;
    const date = qc.inspection_date.slice(0, granularity === "month" ? 7 : 10);
    if (!daily[date]) daily[date] = { planned: 0, actual: 0, good: 0, total: 0, count: 0 };
    daily[date].total++;
    if (qc.result === "pass") daily[date].good++;
  }

  return Object.entries(daily)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const a = d.planned > 0 ? Math.min(1, d.actual / d.planned) : 0;
      const p = d.actual > 0 && d.planned > 0 ? Math.min(1, d.planned / d.actual) : 1;
      const q = d.total > 0 ? d.good / d.total : 1;
      return { date, availability: round(a), performance: round(p), quality: round(q), oee: round(a * p * q), count: d.count };
    });
}

function oeeGrade(v) {
  if (v >= 0.85) return "A+ (世界级)";
  if (v >= 0.75) return "A (优秀)";
  if (v >= 0.65) return "B (良好)";
  if (v >= 0.50) return "C (一般)";
  return "D (需改进)";
}

function getTopLosses(l) {
  const items = [
    { name: "故障停机", pct: l.breakdownPct },
    { name: "换型调试", pct: l.setupPct },
    { name: "速度降低", pct: l.speedPct },
    { name: "小停机",   pct: l.minorStopPct },
    { name: "废品/返工", pct: l.scrapPct },
  ];
  return items.sort((a, b) => b.pct - a.pct).slice(0, 3);
}

function emptyResult() {
  return { availability: 0, performance: 0, quality: 0, oee: 0, grade: "N/A", losses: {}, topLosses: [] };
}

function round(v) { return Math.round(v * 10000) / 10000; }

module.exports = { calculate, buildInput, trendSeries, oeeGrade };
