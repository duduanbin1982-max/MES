"use strict";

const { oeeGrade } = require("../../app/oee/engine");

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
    : oee >= 0.85 ? "A (世界级)" : oee >= 0.75 ? "B (优秀)" : oee >= 0.60 ? "C (一般)" : "D (需改进)";
}

function computeOEEFromShifts(shifts) {
  if (!shifts || shifts.length === 0) {
    return { availability: 0, performance: 0, quality: 0, oee: 0, grade: "D (需改进)" };
  }

  let totalPlanned = 0;
  let totalOperating = 0;
  let totalOutput = 0;
  let totalGood = 0;
  let totalIdealTime = 0;
  let idealCount = 0;

  for (const shift of shifts) {
    if (shift.planned_minutes) totalPlanned += shift.planned_minutes;
    if (shift.operating_minutes) totalOperating += shift.operating_minutes;
    if (shift.total_output) totalOutput += shift.total_output;
    if (shift.good_output) totalGood += shift.good_output;
    if (shift.ideal_cycle_time) {
      totalIdealTime += shift.ideal_cycle_time;
      idealCount += 1;
    }
  }

  const availability = totalPlanned > 0 ? totalOperating / totalPlanned : 0;
  const avgIdealCycleTime = idealCount > 0 ? totalIdealTime / idealCount : 0;
  const performance = totalOperating > 0 && avgIdealCycleTime > 0 ? (totalOutput * avgIdealCycleTime) / totalOperating : 0;
  const quality = totalOutput > 0 ? totalGood / totalOutput : 0;
  const oee = availability * performance * quality;

  return {
    availability: round4(availability),
    performance: round4(performance),
    quality: round4(quality),
    oee: round4(oee),
    grade: gradeFor(oee),
    total_output: totalOutput,
    total_good: totalGood,
    total_planned: round2(totalPlanned),
    total_operating: round2(totalOperating),
  };
}

function equipmentLabel(store, instanceId) {
  if (!instanceId) return null;
  return store.get("SELECT instance_code, instance_name FROM equipment_instances WHERE id = ?", instanceId) || {};
}

module.exports = {
  computeOEEFromShifts,
  equipmentLabel,
  gradeFor,
  pastDate,
  round2,
  round4,
};
