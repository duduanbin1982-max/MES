"use strict";

const { calculate, buildInput } = require("../../app/oee/engine");
const isa95 = require("../../app/oee/isa95");
const { wrap } = require("../../middleware/asyncHandler");
const { computeOEEFromShifts, equipmentLabel, gradeFor, pastDate, round2 } = require("./helpers");
const { catalog, summarize } = require("../../app/oee/lossCatalog");

function registerOverviewRoutes(app, store) {
  const { all } = store;

  function loadShiftsAndLosses(instance_id, days) {
    const d = parseInt(days) || 30;
    const since = pastDate(d);

    let shiftSql = "SELECT * FROM oee_shift_log WHERE shift_date >= ?";
    const shiftParams = [since];
    if (instance_id) {
      shiftSql += " AND equipment_instance_id = ?";
      shiftParams.push(instance_id);
    }
    const shifts = all(shiftSql + " ORDER BY shift_date", shiftParams);

    let lossSql = "SELECT * FROM oee_loss_events WHERE start_time >= ?";
    const lossParams = [since];
    if (instance_id) {
      lossSql += " AND equipment_instance_id = ?";
      lossParams.push(instance_id);
    }
    const lossEvents = all(lossSql + " ORDER BY start_time", lossParams);

    return { days: d, since, shifts, lossEvents };
  }

  function shiftDataRange() {
    try {
      const row = all("SELECT MIN(shift_date) AS min_date, MAX(shift_date) AS max_date FROM oee_shift_log")[0] || {};
      return { first_shift_date: row.min_date || null, latest_shift_date: row.max_date || null };
    } catch (_error) {
      return { first_shift_date: null, latest_shift_date: null };
    }
  }

  app.get("/api/oee/overview", wrap((req, res) => {
    const { instance_id, days } = req.query;
    const { days: d, since, shifts, lossEvents } = loadShiftsAndLosses(instance_id, days);
    const eqLabel = equipmentLabel(store, instance_id);

    if (shifts.length > 0) {
      const oeeResult = computeOEEFromShifts(shifts, lossEvents);
      const lossSummary = summarize(
        lossEvents.map((e) => ({ category_key: e.category_key, loss_category: e.loss_category, minutes: e.duration_minutes }))
      );
      const totalLossMin = lossSummary.byKey.reduce((s, x) => s + (x.counts_as_loss ? x.minutes : 0), 0);
      const completed = shifts.filter((shift) => shift.good_output > 0).length;

      const range = shiftDataRange();
      res.json({
        period: { days: d, since },
        window: { mode: "past", days: d, since },
        data_range: range,
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
        // 2026-10-18 P0-1：ISA-95 三层时间基线
        basis: oeeResult.basis,
        // 损失（规范 key + 中文标签 + bucket），并给出按 ISA-95 三大损失分桶
        losses: lossSummary.byKey.map((x) => ({
          key: x.key, name: x.label, bucket: x.bucket,
          minutes: x.minutes,
          pct_of_planned: oeeResult.basis && oeeResult.basis.planned_production_minutes > 0
            ? round2((x.minutes / oeeResult.basis.planned_production_minutes) * 100) : 0,
          counts_as_loss: x.counts_as_loss,
        })),
        losses_by_bucket: {
          availability: round2(lossSummary.byBucket.availability),
          performance: round2(lossSummary.byBucket.performance),
          quality: round2(lossSummary.byBucket.quality),
          planned_stop: round2(lossSummary.byBucket.none),
        },
        top_losses: lossSummary.byKey.filter((x) => x.counts_as_loss).slice(0, 3).map((x) => ({
          name: x.label,
          pct: totalLossMin > 0 ? round2((x.minutes / totalLossMin) * 100) : 0,
        })),
        // 数据来源分组（manual / iot / system）
        sources: oeeResult.sources,
        // 口径一致性：损失合计 vs 时间差
        data_quality: oeeResult.data_quality,
        loss_catalog_version: catalog.version,
        note: "OEE 按 ISA-95 口径：Availability=run/planned_production，Performance=net_run/run，Quality=good/total",
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
      const range = shiftDataRange();
      res.json({
        period: { days: d, since },
        window: { mode: "past", days: d, since },
        data_range: range,
        hint: range.latest_shift_date
          ? "当前窗口没有班次记录；最近班次在 " + range.latest_shift_date + "，可加大统计周期或补录班次后回看"
          : "还没有班次记录（oee_shift_log）：ISA-95 口径需要班次数据，当前指标退化为工单估算",
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
        basis: null,
        losses: Object.values(result.losses).filter((loss) => loss.pct > 0),
        losses_by_bucket: null,
        top_losses: result.topLosses,
        sources: [],
        data_quality: { ok: false, reason: "no_shift_log", tolerance_pct: isa95.DEFAULT_TOLERANCE * 100 },
        note: "OEE = Availability * Performance * Quality (from work_orders, no shift_log data)",
      });
    }
  }));

  // 口径审计：逐班次重算 + 一致性判定（P0-1 验收：差异 > 2% 的班次应被暴露出来）
  app.get("/api/oee/overview/audit", wrap((req, res) => {
    const { instance_id, days, limit } = req.query;
    const { days: d, since, shifts, lossEvents } = loadShiftsAndLosses(instance_id, days);
    const max = Math.min(parseInt(limit) || 200, 1000);

    const slice = shifts.slice(-max);
    const { perShift } = isa95.computeShifts(slice, lossEvents);

    const rows = perShift.map(({ shift, result: r }) => {
      const evts = r.losses || [];
      return {
        shift_id: shift.id,
        shift_date: shift.shift_date,
        shift_name: shift.shift_name,
        equipment_instance_id: shift.equipment_instance_id,
        shift_minutes: r.basis.shift_minutes,
        planned_stop_minutes: r.basis.planned_stop_minutes,
        planned_production_minutes: r.basis.planned_production_minutes,
        run_minutes: r.basis.run_minutes,
        loss_events: evts.length,
        loss_minutes: r.data_quality.accounted_loss_minutes,
        expected_loss_minutes: r.data_quality.expected_loss_minutes,
        diff_pct: r.data_quality.diff_pct,
        ok: r.data_quality.ok,
        level: r.data_quality.level,
        reason: r.data_quality.reason,
        oee: r.oee,
      };
    });

    // 分级统计（2026-10-18）：legacy=缺基线/归属不可靠，不能算"通过"也不算"错误"；
    // pass_rate 只在"可校验班次"里算，避免历史数据把通过率拉到 2%。
    const verifiable = rows.filter((x) => x.level !== "legacy");
    const mismatch = rows.filter((x) => x.level === "mismatch");
    const legacy = rows.filter((x) => x.level === "legacy");
    res.json({
      period: { days: d, since },
      tolerance_pct: isa95.DEFAULT_TOLERANCE * 100,
      shifts: rows.length,
      verifiable_shifts: verifiable.length,
      legacy_shifts: legacy.length,
      passed: verifiable.length - mismatch.length,
      failed: mismatch.length,
      pass_rate_pct: verifiable.length
        ? Math.round(((verifiable.length - mismatch.length) / verifiable.length) * 10000) / 100
        : null,
      legacy_reason_breakdown: legacy.reduce((acc, x) => {
        const key = x.reason || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      failing_shifts: mismatch.slice(0, 50),
      rows,
    });
  }));

  app.get("/api/oee/compare", wrap((req, res) => {
    const { days } = req.query;
    const d = parseInt(days) || 30;
    const since = pastDate(d);
    const instances = all("SELECT id, instance_code, instance_name FROM equipment_instances ORDER BY id");
    if (instances.length === 0) {
      return res.json({ period: { days: d, since }, instances: [], count: 0, fleet_avg_oee: 0, fleet_grade: "N/A" });
    }

    const lossEvents = all("SELECT * FROM oee_loss_events WHERE start_time >= ?", [since]);
    const instanceOEEs = instances.map((instance) => {
      const shifts = all("SELECT * FROM oee_shift_log WHERE equipment_instance_id = ? AND shift_date >= ? ORDER BY shift_date", [instance.id, since]);
      if (shifts.length > 0) {
        const own = lossEvents.filter((e) => Number(e.equipment_instance_id) === Number(instance.id));
        const result = computeOEEFromShifts(shifts, own);
        return {
          instance_id: instance.id,
          instance_code: instance.instance_code,
          instance_name: instance.instance_name,
          shifts: shifts.length,
          availability: result.availability,
          performance: result.performance,
          quality: result.quality,
          oee: result.oee,
          grade: result.grade,
          total_output: result.total_output,
          total_good: result.total_good,
          total_planned: result.total_planned,
          total_operating: result.total_operating,
          data_quality: result.data_quality,
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
