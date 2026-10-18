"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

const SOURCES = ["manual", "iot", "system"];

function numOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function registerShiftLogRoutes(app, store) {
  const { run } = store;

  // 2026-10-18 P0-1：支持 ISA-95 三层时间基线字段
  app.post("/api/oee/shift-log", wrap((req, res) => {
    const {
      equipment_instance_id, shift_date, shift_name,
      planned_minutes, operating_minutes, ideal_cycle_time, total_output, good_output,
      shift_minutes, planned_stop_minutes, fault_minutes, changeover_minutes, material_wait_minutes, idle_minutes,
      source,
    } = req.body;
    if (!equipment_instance_id || !shift_date || !shift_name) {
      throw ApiError.validation("equipment_instance_id, shift_date, and shift_name required");
    }
    const src = source || "manual";
    if (!SOURCES.includes(src)) throw ApiError.validation(`source 必须是: ${SOURCES.join("/")}`);

    const result = run(
      `INSERT INTO oee_shift_log
        (equipment_instance_id, shift_date, shift_name, planned_minutes, operating_minutes, ideal_cycle_time,
         total_output, good_output, shift_minutes, planned_stop_minutes, fault_minutes, changeover_minutes,
         material_wait_minutes, idle_minutes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        equipment_instance_id, shift_date, shift_name,
        numOrNull(planned_minutes), numOrNull(operating_minutes), numOrNull(ideal_cycle_time),
        numOrNull(total_output), numOrNull(good_output),
        numOrNull(shift_minutes), numOrNull(planned_stop_minutes) || 0, numOrNull(fault_minutes) || 0,
        numOrNull(changeover_minutes) || 0, numOrNull(material_wait_minutes) || 0, numOrNull(idle_minutes) || 0,
        src,
      ]
    );

    res.json({ id: result.lastInsertRowid, equipment_instance_id, shift_date, shift_name, source: src });
  }));
}

module.exports = { registerShiftLogRoutes, SOURCES };
