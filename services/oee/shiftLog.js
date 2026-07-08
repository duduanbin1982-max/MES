"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerShiftLogRoutes(app, store) {
  const { run } = store;

  app.post("/api/oee/shift-log", wrap((req, res) => {
    const { equipment_instance_id, shift_date, shift_name, planned_minutes, operating_minutes, ideal_cycle_time, total_output, good_output } = req.body;
    if (!equipment_instance_id || !shift_date || !shift_name) {
      throw ApiError.validation("equipment_instance_id, shift_date, and shift_name required");
    }

    const result = run(
      `INSERT INTO oee_shift_log (equipment_instance_id, shift_date, shift_name, planned_minutes, operating_minutes, ideal_cycle_time, total_output, good_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [equipment_instance_id, shift_date, shift_name, planned_minutes || null, operating_minutes || null, ideal_cycle_time || null, total_output || null, good_output || null]
    );

    res.json({ id: result.lastInsertRowid, equipment_instance_id, shift_date, shift_name });
  }));
}

module.exports = { registerShiftLogRoutes };
