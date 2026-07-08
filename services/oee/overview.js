"use strict";

const { calculate, buildInput } = require("../../app/oee/engine");
const { wrap } = require("../../middleware/asyncHandler");
const { computeOEEFromShifts, equipmentLabel, gradeFor, pastDate, round2 } = require("./helpers");

function registerOverviewRoutes(app, store) {
  const { all, get } = store;

  app.get("/api/oee/overview", wrap((req, res) => {
    const { instance_id, days } = req.query;
    const d = parseInt(days) || 30;
    const since = pastDate(d);

    let shiftSql = "SELECT * FROM oee_shift_log WHERE shift_date >= ?";
    const shiftParams = [since];
    if (instance_id) {
      shiftSql += " AND equipment_instance_id = ?";
      shiftParams.push(instance_id);
    }
    const shifts = all(shiftSql + " ORDER BY shift_date", shiftParams);

    let lossSql = "SELECT loss_category, COALESCE(SUM(duration_minutes),0) AS total_min FROM oee_loss_events WHERE start_time >= ?";
    const lossParams = [since];
    if (instance_id) {
      lossSql += " AND equipment_instance_id = ?";
      lossParams.push(instance_id);
    }
    lossSql += " GROUP BY loss_category ORDER BY total_min DESC";
    const lossRows = all(lossSql, lossParams);
    const eqLabel = equipmentLabel(store, instance_id);

    if (shifts.length > 0) {
      const oeeResult = computeOEEFromShifts(shifts);
      let totalLossMin = 0;
      const losses = lossRows.map((row) => {
        totalLossMin += row.total_min;
        return { name: row.loss_category, minutes: round2(row.total_min) };
      });
      const topLosses = losses.slice(0, 3).map((loss) => ({
        name: loss.name,
        pct: totalLossMin > 0 ? round2((loss.minutes / totalLossMin) * 100) : 0,
      }));
      const completed = shifts.filter((shift) => shift.good_output > 0).length;

      res.json({
        period: { days: d, since },
        equipment: eqLabel ? { id: Number(instance_id), ...eqLabel } : { all: true },
        data: {
          shifts: shifts.length,
          completed_shifts: completed,
          total_output: oeeResult.total_output,
          total_good: oeeResult.total_good,
        },
        oee: {
          availability: oeeResult.availability,
          performance: oeeResult.performance,
          quality: oeeResult.quality,
          oee: oeeResult.oee,
          grade: oeeResult.grade,
        },
        losses,
        top_losses: topLosses,
        note: "OEE = Availability * Performance * Quality (from shift_log)",
      });
    } else {
      let wos;
      let ops;
      let qcs;
      if (instance_id) {
        wos = all("SELECT * FROM work_orders WHERE equipment_instance_id = ? AND actual_start >= ?", [instance_id, since]);
        ops = all("SELECT wop.* FROM work_order_operations wop JOIN work_orders wo ON wop.work_order_id = wo.id WHERE wo.equipment_instance_id = ? AND wop.timestamp >= ?", [instance_id, since]);
        qcs = all("SELECT * FROM qc_inspections WHERE equipment_instance_id = ? AND inspection_date >= ?", [instance_id, since]);
      } else {
        wos = all("SELECT * FROM work_orders WHERE actual_start >= ?", since);
        ops = all("SELECT wop.* FROM work_order_operations wop JOIN work_orders wo ON wop.work_order_id = wo.id WHERE wop.timestamp >= ?", since);
        qcs = all("SELECT * FROM qc_inspections WHERE inspection_date >= ?", since);
      }

      const input = buildInput(wos, ops, qcs);
      const result = calculate(input);
      res.json({
        period: { days: d, since },
        equipment: eqLabel ? { id: Number(instance_id), ...eqLabel } : { all: true },
        data: {
          work_orders: wos.length,
          completed: wos.filter((workOrder) => workOrder.status === "completed").length,
          in_progress: wos.filter((workOrder) => workOrder.status === "in_progress").length,
          qc_total: qcs.length,
        },
        oee: {
          availability: result.availability,
          performance: result.performance,
          quality: result.quality,
          oee: result.oee,
          grade: result.grade,
        },
        losses: Object.values(result.losses).filter((loss) => loss.pct > 0),
        top_losses: result.topLosses,
        note: "OEE = Availability * Performance * Quality (from work_orders, no shift_log data)",
      });
    }
  }));

  app.get("/api/oee/compare", wrap((req, res) => {
    const { days } = req.query;
    const d = parseInt(days) || 30;
    const since = pastDate(d);
    const instances = all("SELECT id, instance_code, instance_name FROM equipment_instances ORDER BY id");
    if (instances.length === 0) {
      return res.json({ period: { days: d, since }, instances: [], count: 0, fleet_avg_oee: 0, fleet_grade: "N/A" });
    }

    const instanceOEEs = instances.map((instance) => {
      const shifts = all("SELECT * FROM oee_shift_log WHERE equipment_instance_id = ? AND shift_date >= ? ORDER BY shift_date", [instance.id, since]);
      if (shifts.length > 0) {
        return {
          instance_id: instance.id,
          instance_code: instance.instance_code,
          instance_name: instance.instance_name,
          shifts: shifts.length,
          ...computeOEEFromShifts(shifts),
        };
      }
      return {
        instance_id: instance.id,
        instance_code: instance.instance_code,
        instance_name: instance.instance_name,
        shifts: 0,
        availability: 0,
        performance: 0,
        quality: 0,
        oee: 0,
        grade: "N/A (无数据)",
        total_output: 0,
        total_good: 0,
        total_planned: 0,
        total_operating: 0,
      };
    });

    const validOEEs = instanceOEEs.filter((item) => item.shifts > 0);
    const fleetAvg = validOEEs.length > 0
      ? Math.round((validOEEs.reduce((sum, item) => sum + item.oee, 0) / validOEEs.length) * 10000) / 10000
      : 0;

    res.json({
      period: { days: d, since },
      instances: instanceOEEs,
      count: instanceOEEs.length,
      fleet_avg_oee: fleetAvg,
      fleet_grade: gradeFor(fleetAvg),
    });
  }));
}

module.exports = { registerOverviewRoutes };
