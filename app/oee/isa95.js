"use strict";
// app/oee/isa95.js
// OEE 的 ISA-95 口径实现（2026-10-18 P0-1，纯函数，便于单测）
//
// 时间基线（三层）：
//   班次总时长 shift_minutes
//     − 计划停机 planned_stop_minutes                      → 计划生产时间 planned_production
//     − 可用率损失(fault + changeover + idling_waiting)     → 实际运行时间 run
//     − 性能损失(minor_stops + speed_loss)                  → 净运行时间 net_run
//   利用率指标：
//     Availability = run / planned_production
//     Performance  = net_run / run          （等价于 Σ(产出×理论节拍) / run）
//     Quality      = good_output / total_output
//     OEE          = Availability × Performance × Quality
//
// 关键规矩：
//   1) planned_stop 不计入损失（它只影响"计划生产时间"）
//   2) 损失必须能对上时间差：Σ损失（不含 planned_stop）≈ planned_production − run
//      差异超过阈值（默认 2%）时标记 data_quality=false，供报表显示"口径不一致"
//   3) 没有 shift_minutes 的老数据：退化用 planned_minutes 作为班次时长（向后兼容）

const { normalizeKey, countsAsLoss, bucketOf, labelOf } = require("./lossCatalog");

const DEFAULT_TOLERANCE = 0.02;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/** 从一条 shift_log 记录 + 该班次损失记录，算三层时间基线与 OEE */
function computeShift(shift, lossEvents = [], options = {}) {
  const tolerance = options.tolerance || DEFAULT_TOLERANCE;

  const plannedMinutes = num(shift.planned_minutes);
  const shiftMinutes = num(shift.shift_minutes) || (plannedMinutes + num(shift.planned_stop_minutes));
  const plannedStop = num(shift.planned_stop_minutes);
  // 计划生产时间：优先用显式 planned_minutes；否则用 班次−计划停机
  const plannedProduction = plannedMinutes || Math.max(0, shiftMinutes - plannedStop);

  // 损失按 bucket 汇总
  const lossByKey = new Map();
  for (const evt of lossEvents || []) {
    const key = normalizeKey(evt.category_key || evt.loss_category);
    if (!countsAsLoss(key)) continue;
    const minutes = Number(evt.duration_minutes || evt.minutes || 0) || 0;
    lossByKey.set(key, (lossByKey.get(key) || 0) + minutes);
  }

  const explicitAvailabilityLoss =
    num(shift.fault_minutes) + num(shift.changeover_minutes) + num(shift.material_wait_minutes);
  const explicitIdle = num(shift.idle_minutes);

  // 损失来源二选一，避免"显式字段 + 损失事件"重复计算：
  //   - 班次记录里有显式拆分（故障/换型/待料/空转）→ 以显式字段为准
  //   - 否则 → 用损失事件按 bucket 求和
  let eventAvailabilityLoss = 0;
  let eventPerformanceLoss = 0;
  let qualityLossMinutes = 0;
  for (const [key, minutes] of lossByKey.entries()) {
    const bucket = bucketOf(key);
    if (bucket === "availability") eventAvailabilityLoss += minutes;
    else if (bucket === "performance") eventPerformanceLoss += minutes;
    else if (bucket === "quality") qualityLossMinutes += minutes;
  }
  const useExplicit = explicitAvailabilityLoss > 0 || explicitIdle > 0;
  const availabilityLoss = useExplicit ? explicitAvailabilityLoss : eventAvailabilityLoss;
  const performanceLoss = useExplicit ? explicitIdle : eventPerformanceLoss;

  const runTime = num(shift.operating_minutes) || Math.max(0, plannedProduction - availabilityLoss);
  const idealCycle = num(shift.ideal_cycle_time); // 分钟/件
  const totalOutput = num(shift.total_output);
  const goodOutput = num(shift.good_output);

  const theoreticalRun = idealCycle > 0 && totalOutput > 0 ? idealCycle * totalOutput : 0;
  const netRunTime = theoreticalRun > 0 ? Math.min(runTime, theoreticalRun) : Math.max(0, runTime - performanceLoss);

  const availability = plannedProduction > 0 ? Math.min(1, runTime / plannedProduction) : 0;
  const performance = runTime > 0 && theoreticalRun > 0
    ? Math.min(1, theoreticalRun / runTime)
    : (runTime > 0 ? Math.min(1, (runTime - performanceLoss) / runTime) : 0);
  const quality = totalOutput > 0 ? Math.min(1, goodOutput / totalOutput) : 1;
  const oee = availability * performance * quality;

  // 口径一致性：损失合计 vs 时间差
  // 数据质量三级（2026-10-18 P0-1）：
  //   ok        = 口径一致（损失合计 与 时间差 在容忍范围内）
  //   mismatch  = 有基线数据但两者差异超阈值 → 需要业务补录/纠正
  //   legacy    = 缺三层基线字段（旧数据）→ 无法校验，不能算"通过"也不算"错误"
  const hasBasis = shiftMinutes > 0 || plannedStop > 0 || useExplicit || num(shift.operating_minutes) > 0;
  // 2026-10-19：质量损失是"件/不合格品"口径，不是时间口径 —— 不进"损失合计 vs 时间差"的对账，
  // 否则质量事件越多，diff 越大，明明基线正确也被判成 mismatch（补录后 52 个班次被误判为 legacy 的原因）。
  const accountedLoss = availabilityLoss + performanceLoss;
  const expectedLoss = Math.max(0, plannedProduction - runTime) + performanceLoss;
  const diff = Math.abs(accountedLoss - expectedLoss);
  const diffPct = expectedLoss > 0 ? diff / expectedLoss : (diff > 0 ? 1 : 0);
  const level = !hasBasis ? "legacy" : (diffPct <= tolerance ? "ok" : "mismatch");
  const unreliableEvents = options.unreliableEvents === true;
  let finalLevel = level;
  let reason = null;
  if (level === "legacy") {
    reason = "missing_basis";
  } else if (level === "mismatch" && unreliableEvents && !useExplicit) {
    // 同一天多个班次时，损失事件没有 shift_log_id，无法可靠归属到某个班次：
    // 此时"损失合计 vs 时间差"的差异是假阳性，标为 legacy（不可校验）而不是 mismatch。
    // 2026-10-19：若班次已有**显式基线**（fault/changeover/material_wait），以显式字段为准，
    // 事件归属是否可靠不再影响判定（补录后应全部可校验）。
    finalLevel = "legacy";
    reason = "ambiguous_event_attribution";
  }

  const losses = [...lossByKey.entries()].map(([key, minutes]) => ({
    key,
    label: labelOf(key),
    bucket: bucketOf(key),
    minutes: Math.round(minutes * 100) / 100,
  }));

  return {
    basis: {
      shift_minutes: round4(shiftMinutes),
      planned_stop_minutes: round4(plannedStop),
      planned_production_minutes: round4(plannedProduction),
      run_minutes: round4(runTime),
      net_run_minutes: round4(netRunTime),
      availability_loss_minutes: round4(availabilityLoss),
      performance_loss_minutes: round4(performanceLoss),
      quality_loss_minutes: round4(qualityLossMinutes),
    },
    availability: round4(availability),
    performance: round4(performance),
    quality: round4(quality),
    oee: round4(oee),
    losses,
    data_quality: {
      ok: finalLevel === "ok",
      level: finalLevel,
      verifiable: finalLevel !== "legacy",
      reason,
      tolerance_pct: Math.round(tolerance * 10000) / 100,
      accounted_loss_minutes: round4(accountedLoss),
      expected_loss_minutes: round4(expectedLoss),
      diff_minutes: round4(diff),
      diff_pct: Math.round(diffPct * 10000) / 100,
    },
  };
}

/** 多班次聚合（按时间累加，再算比率——不能对百分数取平均） */
function aggregateShifts(perShift, options = {}) {
  const tolerance = options.tolerance || DEFAULT_TOLERANCE;
  const acc = {
    shift_minutes: 0,
    planned_stop_minutes: 0,
    planned_production_minutes: 0,
    run_minutes: 0,
    net_run_minutes: 0,
    availability_loss_minutes: 0,
    performance_loss_minutes: 0,
    quality_loss_minutes: 0,
  };
  const lossByKey = new Map();
  const sources = new Map();
  let dataQualityOk = true;
  let worstDiffPct = 0;
  const qualityLevels = { ok: 0, mismatch: 0, legacy: 0 };

  for (const item of perShift || []) {
    const b = item.result.basis;
    for (const k of Object.keys(acc)) acc[k] += b[k] || 0;
    for (const loss of item.result.losses) lossByKey.set(loss.key, (lossByKey.get(loss.key) || 0) + loss.minutes);
    const src = item.shift.source || "manual";
    sources.set(src, (sources.get(src) || 0) + 1);
    const lv = item.result.data_quality.level || "legacy";
    qualityLevels[lv] = (qualityLevels[lv] || 0) + 1;
    if (lv === "mismatch") dataQualityOk = false;
    if (lv !== "legacy") worstDiffPct = Math.max(worstDiffPct, item.result.data_quality.diff_pct);
  }

  const availability = acc.planned_production_minutes > 0 ? acc.run_minutes / acc.planned_production_minutes : 0;
  const performance = acc.run_minutes > 0 ? acc.net_run_minutes / acc.run_minutes : 0;
  // quality 用产出量算（aggregate 时由调用方补 total/good，见 services/oee/helpers）
  return {
    basis: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, round4(v)])),
    availability: round4(Math.min(1, availability)),
    performance: round4(Math.min(1, performance)),
    losses: [...lossByKey.entries()]
      .map(([key, minutes]) => ({ key, label: labelOf(key), bucket: bucketOf(key), minutes: Math.round(minutes * 100) / 100 }))
      .sort((a, b) => b.minutes - a.minutes),
    sources: [...sources.entries()].map(([source, shifts]) => ({ source, shifts })),
    data_quality: {
      ok: dataQualityOk,
      // 聚合层的等级：有 mismatch → mismatch；有可校验班次且无误 → ok；全 legacy → legacy
      level: qualityLevels.mismatch > 0 ? "mismatch" : (qualityLevels.ok > 0 ? "ok" : "legacy"),
      worst_diff_pct: Math.round(worstDiffPct * 100) / 100,
      tolerance_pct: Math.round(tolerance * 10000) / 100,
      levels: qualityLevels,
      verifiable_shifts: qualityLevels.ok + qualityLevels.mismatch,
      legacy_shifts: qualityLevels.legacy,
      pass_rate_pct: qualityLevels.mismatch + qualityLevels.ok > 0
        ? Math.round((qualityLevels.ok / (qualityLevels.ok + qualityLevels.mismatch)) * 10000) / 100
        : null,
    },
  };
}

/**
 * 批量计算（唯一入口）：按 (equipment_instance_id, shift_date) 把损失事件归属到班次；
 * 同一设备同日多于 1 个班次时，损失事件无法可靠归属 → 该班次标记 legacy（而非假阳性 mismatch）。
 * @returns {{ perShift: Array<{shift: object, result: object}>, aggregate: object }}
 */
function computeShifts(shifts, lossEvents = [], options = {}) {
  const byInstanceDate = new Map();
  for (const evt of lossEvents || []) {
    const date = String(evt.start_time || "").slice(0, 10);
    const key = `${evt.equipment_instance_id}|${date}`;
    if (!byInstanceDate.has(key)) byInstanceDate.set(key, []);
    byInstanceDate.get(key).push(evt);
  }

  const dayCount = new Map();
  for (const shift of shifts || []) {
    const key = `${shift.equipment_instance_id}|${String(shift.shift_date || "").slice(0, 10)}`;
    dayCount.set(key, (dayCount.get(key) || 0) + 1);
  }

  const perShift = (shifts || []).map((shift) => {
    const key = `${shift.equipment_instance_id}|${String(shift.shift_date || "").slice(0, 10)}`;
    return {
      shift,
      result: computeShift(shift, byInstanceDate.get(key) || [], {
        ...options,
        unreliableEvents: (dayCount.get(key) || 0) > 1,
      }),
    };
  });

  return { perShift, aggregate: aggregateShifts(perShift, options) };
}

function grade(oee) {
  if (oee >= 0.85) return "A+";
  if (oee >= 0.75) return "A";
  if (oee >= 0.65) return "B";
  if (oee >= 0.50) return "C";
  return "D";
}

module.exports = { computeShift, computeShifts, aggregateShifts, grade, DEFAULT_TOLERANCE };
