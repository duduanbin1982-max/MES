"use strict";
// app/spc/engine.js
// P1 SPC 统计过程控制引擎
//   Xbar-R 控制图 / Cpk/Ppk 过程能力 / WECO 异常规则
// Author: 三狗子 | Date: 2026-06-26
//
// ⚠️  @deprecated 2026-07-11 (brooks-audit R4 决策 ADR-003)
//   0 外部 require (只有 spcService.js 自己提了一些, 但 register-all 未注册这个路径)
//   实际 SPC 业务跑在 services/spcService.js + services/spcMonitor.js
//   保留: 历史快照 / 复盘参考
//   未来: Phase 2 cleanup 时评估删除

// d2 常数 (子组大小 n 的无偏估计因子)
const D2 = [0, 0, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078];
// A2 常数 (Xbar 控制限)
const A2 = [0, 0, 1.880, 1.023, 0.729, 0.577, 0.483, 0.419, 0.373, 0.337, 0.308];
// D3/D4 常数 (R 图控制限)
const D3 = [0, 0, 0, 0, 0, 0, 0, 0.076, 0.136, 0.184, 0.223];
const D4 = [0, 0, 3.267, 2.574, 2.282, 2.114, 2.004, 1.924, 1.864, 1.816, 1.777];

function clamp(n, max) { return Math.min(max, Math.max(0, Math.floor(n))); }
function r3(v) { return Math.round(v * 1000) / 1000; }

/**
 * 将原始测量值按时间分组成子组
 * @param {number[]} values - 原始值数组
 * @param {number} subgroupSize - 子组大小 (默认 5)
 * @returns {Array<{values: number[], mean: number, range: number}>}
 */
function buildSubgroups(values, subgroupSize) {
  // 2026-11-07 审计修复: 子组大小必须是 2..10; 非法值(0/1/小数/字符串)回退 5,
  // 否则 chunk.length < 2 会把所有子组丢掉, 前端只看到"数据不足"。
  const requested = Number(subgroupSize);
  subgroupSize = Number.isInteger(requested) && requested >= 2 ? clamp(requested, 10) : 5;
  const groups = [];
  for (let i = 0; i < values.length; i += subgroupSize) {
    const chunk = values.slice(i, i + subgroupSize);
    if (chunk.length < 2) continue;
    const mean = chunk.reduce((s, v) => s + v, 0) / chunk.length;
    const range = Math.max(...chunk) - Math.min(...chunk);
    groups.push({ values: chunk, mean: Math.round(mean * 1000) / 1000, range: Math.round(range * 1000) / 1000 });
  }
  return groups;
}

/**
 * 计算 Xbar-R 控制图数据
 */
function xbarR(values, subgroupSize, usl, lsl) {
  const groups = buildSubgroups(values, subgroupSize);
  if (groups.length < 2) return { error: "数据不足，至少需要 2 个子组" };

  const n = Math.min(groups[0].values.length, 10);
  const grandMean = groups.reduce((s, g) => s + g.mean, 0) / groups.length;
  const meanRange = groups.reduce((s, g) => s + g.range, 0) / groups.length;

  const uclX = grandMean + A2[n] * meanRange;
  const lclX = grandMean - A2[n] * meanRange;
  const uclR = D4[n] * meanRange;
  const lclR = D3[n] * meanRange;

  return {
    subgroups: groups,
    n,
    count: groups.length,
    grandMean: Math.round(grandMean * 1000) / 1000,
    meanRange: Math.round(meanRange * 1000) / 1000,
    sigma: Math.round((meanRange / D2[n]) * 1000) / 1000,
    xbar: {
      cl: Math.round(grandMean * 1000) / 1000,
      ucl: Math.round(uclX * 1000) / 1000,
      lcl: Math.round(lclX * 1000) / 1000,
      usl: usl || null,
      lsl: lsl || null,
    },
    r: {
      cl: Math.round(meanRange * 1000) / 1000,
      ucl: Math.round(uclR * 1000) / 1000,
      lcl: Math.round(lclR * 1000) / 1000,
    },
  };
}

/**
 * 计算 Cpk / Ppk
 * Cpk = min((USL - μ) / 3σ, (μ - LSL) / 3σ)
 * Ppk 使用整体标准差 (所有值)
 */
function capability(values, usl, lsl) {
  if (!Array.isArray(values) || !values.length) return { error: "无数据" };
  if (!usl && !lsl) return { error: "至少需要 USL 或 LSL" };
  if (values.length < 2) return { error: "样本数不足(需>=2)" };

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  const sigmaOverall = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

  // 2026-11-07 审计修复: 所有测量值相同时 sigma=0, 原实现算出 Infinity/NaN,
  // JSON 序列化成 null, 但 spcMonitor 写库会存 Inf。这里显式返回 cpk=null + note。
  if (!Number.isFinite(sigma) || sigma <= 0 || !Number.isFinite(sigmaOverall) || sigmaOverall <= 0) {
    return {
      n,
      mean: r3(mean),
      sigma_within: 0,
      sigma_overall: 0,
      usl: usl || null,
      lsl: lsl || null,
      cp: null,
      cpk: null,
      pp: null,
      ppk: null,
      grade: "N/A (零方差)",
      min: r3(Math.min(...values)),
      max: r3(Math.max(...values)),
      note: "测量值无波动(sigma=0)，过程能力不可计算",
    };
  }

  const cpu = usl ? (usl - mean) / (3 * sigma) : null;
  const cpl = lsl ? (mean - lsl) / (3 * sigma) : null;
  const cpk = cpu !== null && cpl !== null ? Math.min(cpu, cpl)
    : cpu !== null ? cpu
    : cpl;

  const ppu = usl ? (usl - mean) / (3 * sigmaOverall) : null;
  const ppl = lsl ? (mean - lsl) / (3 * sigmaOverall) : null;
  const ppk = ppu !== null && ppl !== null ? Math.min(ppu, ppl)
    : ppu !== null ? ppu
    : ppl;

  return {
    n,
    mean: Math.round(mean * 1000) / 1000,
    sigma_within: Math.round(sigma * 1000) / 1000,
    sigma_overall: Math.round(sigmaOverall * 1000) / 1000,
    usl: usl || null,
    lsl: lsl || null,
    cp: usl && lsl ? Math.round(((usl - lsl) / (6 * sigma)) * 100) / 100 : null,
    cpk: cpk == null ? null : Math.round(cpk * 100) / 100,
    pp: usl && lsl ? Math.round(((usl - lsl) / (6 * sigmaOverall)) * 100) / 100 : null,
    ppk: ppk == null ? null : Math.round(ppk * 100) / 100,
    grade: cpkGrade(cpk),
    min: Math.round(Math.min(...values) * 1000) / 1000,
    max: Math.round(Math.max(...values) * 1000) / 1000,
  };
}

function cpkGrade(cpk) {
  if (cpk === null) return "N/A";
  if (cpk >= 1.67) return "A+ (特优)";
  if (cpk >= 1.33) return "A (充足)";
  if (cpk >= 1.00) return "B (尚可)";
  if (cpk >= 0.67) return "C (不足)";
  return "D (严重不足)";
}

/**
 * WECO (Western Electric) 异常检测规则
 * 返回违反规则的点索引列表
 */
function wecoRules(groups) {
  if (!Array.isArray(groups) || groups.length < 2) return [];
  const means = groups.map((g) => g.mean);
  const grandMean = means.reduce((s, m) => s + m, 0) / means.length;
  const sigma = Math.sqrt(means.reduce((s, m) => s + (m - grandMean) ** 2, 0) / (means.length - 1));
  // 2026-11-07 审计修复: 零方差时 |x-CL| <= 1σ 恒成立, 规则7(连续15点在±1σ内)
  // 会对一条完全平直的数据误报"分层"。无波动即无异常规则可判, 直接返回空。
  if (!Number.isFinite(sigma) || sigma <= 0) return [];
  const alerts = [];

  // Rule 1: 任意点超出 ±3σ
  for (let i = 0; i < means.length; i++) {
    if (Math.abs(means[i] - grandMean) > 3 * sigma) {
      alerts.push({ rule: 1, desc: "超出 3σ 控制限", point: i, value: means[i] });
    }
  }

  // Rule 2: 连续 9 点在同一侧
  let sideRun = 0; let lastSide = 0;
  for (let i = 0; i < means.length; i++) {
    const side = means[i] > grandMean ? 1 : means[i] < grandMean ? -1 : 0;
    if (side === lastSide && side !== 0) {
      sideRun++;
      if (sideRun >= 9) alerts.push({ rule: 2, desc: "连续 9 点在同一侧", point: i, side: side > 0 ? "上" : "下" });
    } else { sideRun = 1; lastSide = side; }
  }

  // Rule 3: 连续 6 点上升或下降
  let upRun = 0, downRun = 0;
  for (let i = 1; i < means.length; i++) {
    if (means[i] > means[i - 1]) { upRun++; downRun = 0; }
    else if (means[i] < means[i - 1]) { downRun++; upRun = 0; }
    else { upRun = 0; downRun = 0; }
    if (upRun >= 6) alerts.push({ rule: 3, desc: "连续 6 点上升 (趋势)", point: i });
    if (downRun >= 6) alerts.push({ rule: 3, desc: "连续 6 点下降 (趋势)", point: i });
  }

  // Rule 4: 连续 14 点交替上下
  let altCount = 0;
  for (let i = 2; i < means.length; i++) {
    if ((means[i] - means[i - 1]) * (means[i - 1] - means[i - 2]) < 0) {
      altCount++;
      if (altCount >= 14) alerts.push({ rule: 4, desc: "连续 14 点交替振荡", point: i });
    } else { altCount = 0; }
  }

  // Rule 5: 连续 3 点中 2 点超出 2σ (同一侧)
  for (let i = 0; i <= means.length - 3; i++) {
    const win = means.slice(i, i + 3);
    const beyond2s = win.filter((m) => Math.abs(m - grandMean) > 2 * sigma);
    const side = win[0] > grandMean ? 1 : -1;
    const sameSide = win.every((m) => (m - grandMean) * side > 0);
    if (beyond2s.length >= 2 && sameSide) {
      alerts.push({ rule: 5, desc: "3 点中 2 点 > 2σ", point: i + 2 });
    }
  }

  // Rule 6: 连续 5 点中 4 点超出 1σ (同一侧)
  for (let i = 0; i <= means.length - 5; i++) {
    const win = means.slice(i, i + 5);
    const beyond1s = win.filter((m) => Math.abs(m - grandMean) > 1 * sigma);
    const side = win[0] > grandMean ? 1 : -1;
    const sameSide = win.every((m) => (m - grandMean) * side > 0);
    if (beyond1s.length >= 4 && sameSide) {
      alerts.push({ rule: 6, desc: "5 点中 4 点 > 1σ", point: i + 4 });
    }
  }

  // Rule 7: 连续 15 点全部在 ±1σ 内
  let in1sRun = 0;
  for (let i = 0; i < means.length; i++) {
    if (Math.abs(means[i] - grandMean) <= 1 * sigma) {
      in1sRun++;
      if (in1sRun >= 15) alerts.push({ rule: 7, desc: "连续 15 点在 ±1σ 内 (分层)", point: i });
    } else { in1sRun = 0; }
  }

  // Rule 8: 连续 8 点全部在 ±1σ 外 (双侧)
  let out1sRun = 0;
  for (let i = 0; i < means.length; i++) {
    if (Math.abs(means[i] - grandMean) > 1 * sigma) {
      out1sRun++;
      if (out1sRun >= 8) alerts.push({ rule: 8, desc: "连续 8 点在 ±1σ 外", point: i });
    } else { out1sRun = 0; }
  }

  return alerts;
}

module.exports = { buildSubgroups, xbarR, capability, capIndex: capability, cpkGrade, wecoRules, A2, D3, D4, D2 };
