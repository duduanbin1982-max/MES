"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");
const { computeOEEFromShifts, pastDate, round2, round4 } = require("./helpers");

function registerTrendRoutes(app, store) {
  const { all } = store;

  app.get("/api/oee/trend", wrap((req, res) => {
    const { instance_id, days, gran } = req.query;
    const d = parseInt(days) || 90;
    const since = pastDate(d);
    const granularity = gran || "day";

    let shiftSql = "SELECT * FROM oee_shift_log WHERE shift_date >= ?";
    const shiftParams = [since];
    if (instance_id) {
      shiftSql += " AND equipment_instance_id = ?";
      shiftParams.push(instance_id);
    }
    const shifts = all(shiftSql + " ORDER BY shift_date, shift_name", shiftParams);
    if (shifts.length === 0) {
      return res.json({ period: { days: d, since }, granularity, points: [], series: null, stats: { min: 0, max: 0, avg: 0, count: 0 }, note: "No shift_log data" });
    }

    const dayMap = {};
    for (const shift of shifts) {
      const date = shift.shift_date;
      if (!dayMap[date]) dayMap[date] = [];
      dayMap[date].push(shift);
    }

    const points = [];
    const oees = [];
    for (const date of Object.keys(dayMap).sort()) {
      const daily = computeOEEFromShifts(dayMap[date]);
      points.push({
        date,
        oee: daily.oee,
        availability: daily.availability,
        performance: daily.performance,
        quality: daily.quality,
        shifts: dayMap[date].length,
        output: daily.total_output,
      });
      oees.push(daily.oee);
    }

    const stats = oees.length > 0 ? {
      min: round4(Math.min(...oees)),
      max: round4(Math.max(...oees)),
      avg: round4(oees.reduce((sum, value) => sum + value, 0) / oees.length),
      count: oees.length,
    } : { min: 0, max: 0, avg: 0, count: 0 };

    res.json({
      period: { days: d, since },
      granularity,
      points,
      series: {
        oee: points.map((point) => ({ x: point.date, y: point.oee })),
        availability: points.map((point) => ({ x: point.date, y: point.availability })),
        performance: points.map((point) => ({ x: point.date, y: point.performance })),
        quality: points.map((point) => ({ x: point.date, y: point.quality })),
      },
      stats,
    });
  }));

  app.get("/api/oee/shift-comparison", wrap((req, res) => {
    const { instance_id, from, to } = req.query;
    if (!instance_id) throw ApiError.validation("instance_id required");

    let sql = "SELECT * FROM oee_shift_log WHERE equipment_instance_id = ?";
    const params = [instance_id];
    if (from) { sql += " AND shift_date >= ?"; params.push(from); }
    if (to) { sql += " AND shift_date <= ?"; params.push(to); }
    sql += " ORDER BY shift_date, shift_name";
    const logs = all(sql, params);

    const shiftMap = {};
    for (const log of logs) {
      if (!shiftMap[log.shift_name]) shiftMap[log.shift_name] = [];
      shiftMap[log.shift_name].push(log);
    }

    const shifts = [];
    for (const [shiftName, entries] of Object.entries(shiftMap)) {
      const oee = computeOEEFromShifts(entries);
      let lossSql = "SELECT loss_category, COALESCE(SUM(duration_minutes), 0) AS total_min FROM oee_loss_events WHERE equipment_instance_id = ?";
      const lossParams = [instance_id];
      if (from) { lossSql += " AND start_time >= ?"; lossParams.push(from); }
      if (to) { lossSql += " AND start_time <= ?"; lossParams.push(to); }
      lossSql += " GROUP BY loss_category";
      const lossRows = all(lossSql, lossParams);
      const losses_breakdown = {};
      for (const row of lossRows) {
        losses_breakdown[row.loss_category + "_min"] = round2(row.total_min);
      }

      shifts.push({
        shift_name: shiftName,
        entries: entries.length,
        oee: oee.oee,
        availability: oee.availability,
        performance: oee.performance,
        quality: oee.quality,
        total_output: oee.total_output,
        losses_breakdown,
      });
    }

    res.json({
      instance_id: parseInt(instance_id),
      period: { from: from || "all", to: to || "all" },
      shifts,
    });
  }));
}

module.exports = { registerTrendRoutes };
