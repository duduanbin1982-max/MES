"use strict";

const { oeeGrade } = require("../../app/oee/engine");
const isa95 = require("../../app/oee/isa95");
const { normalizeKey, labelOf, bucketOf } = require("../../app/oee/lossCatalog");

function pastDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - (days || 30));
  return date.toISOString().slice(0, 10);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function gradeFor(oee) {
  return oeeGrade
    ? oeeGrade(oee)
    : isa95.grade(oee);
}

/**
 * 多班次 OEE（2026-10-18 改为 ISA-95 口径）
 * @param {Array} shifts oee_shift_log 行
 * @param {Array} lossEvents oee_loss_events 行（同一时间段；按 equipment_instance_id + 日期 归属到班次）
 */
function computeOEEFromShifts(shifts, lossEvents) {
  if (!shifts || shifts.length === 0) {
    return {
      availability: 0, performance: 0, quality: 0, oee: 0, grade: "D (需改进)",
      basis: null, losses: [], sources: [], data_quality: { ok: true, worst_diff_pct: 0, tolerance_pct: 2 },
      total_output: 0, total_good: 0, total_planned: 0, total_operating: 0,
    };
  }

  const { aggregate: agg } = isa95.computeShifts(shifts, lossEvents);


  // 质量用产出量重算（聚合口径）
  let totalOutput = 0;
  let totalGood = 0;
  for (const s of shifts) {
    totalOutput += Number(s.total_output) || 0;
    totalGood += Number(s.good_output) || 0;
  }
  const quality = totalOutput > 0 ? totalGood / totalOutput : 0;
  const oee = agg.availability * agg.performance * quality;

  return {
    availability: round4(agg.availability),
    performance: round4(agg.performance),
    quality: round4(quality),
    oee: round4(oee),
    grade: gradeFor(oee),
    basis: agg.basis,
    losses: agg.losses,
    sources: agg.sources,
    data_quality: agg.data_quality,
    total_output: totalOutput,
    total_good: totalGood,
    total_planned: round2(agg.basis ? agg.basis.planned_production_minutes : 0),
    total_operating: round2(agg.basis ? agg.basis.run_minutes : 0),
    shift_count: shifts.length,
  };
}

function equipmentLabel(store, instanceId) {
  if (!instanceId) return null;
  return store.get("SELECT instance_code, instance_name FROM equipment_instances WHERE id = ?", instanceId) || {};
}

/** 损失事件归一化（供路由层使用） */
function normalizeLoss(row) {
  const key = normalizeKey(row.category_key || row.loss_category);
  return { key, label: labelOf(key), bucket: bucketOf(key) };
}

module.exports = {
  computeOEEFromShifts,
  equipmentLabel,
  gradeFor,
  pastDate,
  round2,
  round4,
  normalizeLoss,
};
