"use strict";
// services/processHours/analyticsRoutes.js
// 2026-11-06 审计整改（WH-3/WH-4/WH-8）：
//   · 工人效率：标准工时改为取工序定额（原实现用实际工时×8，导致效率恒为 12.5%）
//   · 默认日期区间用本地日期（原 toISOString 按 UTC）
//   · 加班阈值可配置（默认 8h）
const { wrap } = require("../../middleware/asyncHandler");
const { todaySqlDate } = require("../../shared/datetime");

function shiftDate(dateStr, days) {
  const base = new Date(dateStr + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function registerWorkerPerformance(app, db) {
  const all = (sql, params) => db.prepare(sql).all(...(params || []));
  const get = (sql, params) => db.prepare(sql).get(...(params || []));
  const OVERTIME_THRESHOLD = Math.max(1, Number(process.env.OVERTIME_DAILY_HOURS) || 8);

  app.get("/api/process-hours/worker-performance", wrap((req, res) => {
    const { from, to } = req.query;
    const dateTo = to || todaySqlDate();
    const dateFrom = from || shiftDate(dateTo, -30);
    const rows = all(`
      SELECT wr.worker_id, u.full_name, u.username,
             SUM(wr.hours_spent) AS total_hours,
             COUNT(DISTINCT wr.work_order_id) AS tasks_completed,
             SUM(CASE WHEN wr.quality_result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
             COUNT(*) AS total_reports
      FROM work_report_details wr
      LEFT JOIN users u ON wr.worker_id = u.id
      WHERE wr.reported_at >= ? AND wr.reported_at <= ? AND wr.worker_id IS NOT NULL
      GROUP BY wr.worker_id
      ORDER BY total_hours DESC
    `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);

    const workers = rows.map((row) => {
      const nodeIds = all("SELECT DISTINCT process_node_id FROM work_report_details WHERE worker_id=? AND process_node_id IS NOT NULL AND reported_at >= ? AND reported_at <= ?",
        [row.worker_id, `${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]).map((item) => item.process_node_id);
      let standardManHours = 0;
      if (nodeIds.length) {
        const placeholders = nodeIds.map(() => "?").join(",");
        const standard = get(`SELECT COALESCE(SUM(standard_hours * worker_count), 0) AS total FROM process_standard_hours WHERE process_node_id IN (${placeholders})`, nodeIds);
        standardManHours = Number(standard.total) || 0;
      }
      const totalHours = Number(row.total_hours) || 0;
      return {
        user_id: row.worker_id,
        full_name: row.full_name || `User #${row.worker_id}`,
        total_hours: Math.round(totalHours * 100) / 100,
        standard_hours: standardManHours > 0 ? Math.round(standardManHours * 100) / 100 : null,
        // 效率 = 标准工时 / 实际工时 × 100（没有定额时为 null，而不是给一个假的百分比）
        efficiency_pct: standardManHours > 0 && totalHours > 0 ? Math.round((standardManHours / totalHours) * 10000) / 100 : null,
        tasks_completed: row.tasks_completed,
        avg_quality_score: row.total_reports > 0 ? Math.round((row.pass_count / row.total_reports) * 10000) / 100 : 0,
      };
    });
    const withStandard = workers.filter((worker) => worker.standard_hours !== null && worker.total_hours > 0);
    const summary = {
      avg_efficiency: withStandard.length
        ? Math.round((withStandard.reduce((sum, worker) => sum + worker.efficiency_pct, 0) / withStandard.length) * 100) / 100
        : null,
      total_hours_sum: Math.round(workers.reduce((sum, worker) => sum + worker.total_hours, 0) * 100) / 100,
      total_tasks: workers.reduce((sum, worker) => sum + worker.tasks_completed, 0),
      workers_with_standard: withStandard.length,
    };
    res.json({ period: { from: dateFrom, to: dateTo }, summary, workers, count: workers.length });
  }));

  app.get("/api/process-hours/overtime", wrap((req, res) => {
    const { from, to } = req.query;
    const dateTo = to || todaySqlDate();
    const dateFrom = from || shiftDate(dateTo, -30);
    const rows = all(`
      SELECT wr.worker_id, u.full_name, date(wr.reported_at) AS work_date,
             SUM(wr.hours_spent) AS daily_hours
      FROM work_report_details wr
      LEFT JOIN users u ON wr.worker_id = u.id
      WHERE wr.reported_at >= ? AND wr.reported_at <= ? AND wr.worker_id IS NOT NULL
      GROUP BY wr.worker_id, date(wr.reported_at)
      HAVING daily_hours > ?
      ORDER BY work_date DESC, daily_hours DESC
    `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`, OVERTIME_THRESHOLD]);
    const records = rows.map((row) => ({
      user_id: row.worker_id,
      full_name: row.full_name || `User #${row.worker_id}`,
      date: row.work_date,
      daily_hours: Math.round(row.daily_hours * 100) / 100,
      overtime_hours: Math.round((row.daily_hours - OVERTIME_THRESHOLD) * 100) / 100,
      overtime_pct: Math.round(((row.daily_hours - OVERTIME_THRESHOLD) / OVERTIME_THRESHOLD) * 10000) / 100,
    }));
    let totalOvertimeHours = 0;
    const byWorker = {};
    for (const record of records) {
      totalOvertimeHours += record.overtime_hours;
      if (!byWorker[record.user_id]) {
        byWorker[record.user_id] = { user_id: record.user_id, full_name: record.full_name, overtime_hours: 0, overtime_days: 0 };
      }
      byWorker[record.user_id].overtime_hours += record.overtime_hours;
      byWorker[record.user_id].overtime_days += 1;
    }
    res.json({
      period: { from: dateFrom, to: dateTo },
      daily_threshold_hours: OVERTIME_THRESHOLD,
      overtime_days: records.length,
      total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
      by_worker: Object.values(byWorker).sort((left, right) => right.overtime_hours - left.overtime_hours),
      records,
    });
  }));

  app.get("/api/process-hours/daily-summary", wrap((req, res) => {
    const date = req.query.date || todaySqlDate();
    const workers = all(`
      SELECT wr.worker_id, u.full_name,
             COUNT(*) AS report_count,
             SUM(wr.hours_spent) AS total_hours,
             SUM(wr.quantity_completed) AS total_qty,
             COUNT(DISTINCT wr.work_order_id) AS wo_count
      FROM work_report_details wr
      LEFT JOIN users u ON wr.worker_id = u.id
      WHERE date(wr.reported_at) = ?
      GROUP BY wr.worker_id
      ORDER BY total_hours DESC
    `, [date]);
    const workOrders = all(`
      SELECT DISTINCT wo.id, wo.wo_code, wo.title, wo.status, wo.equipment_instance_id,
             ei.instance_code, ei.instance_name
      FROM work_report_details wr
      JOIN work_orders wo ON wr.work_order_id = wo.id
      LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
      WHERE date(wr.reported_at) = ?
      ORDER BY wo.id
    `, [date]);
    const instanceIds = [...new Set(workOrders.map((item) => item.equipment_instance_id).filter(Boolean))];
    const instances = instanceIds.length
      ? all(`SELECT id, instance_code, instance_name, status FROM equipment_instances WHERE id IN (${instanceIds.map(() => "?").join(",")})`, instanceIds)
      : [];
    const totals = workers.reduce((result, worker) => ({
      hours: result.hours + (worker.total_hours || 0),
      quantity: result.quantity + (worker.total_qty || 0),
      reports: result.reports + worker.report_count,
    }), { hours: 0, quantity: 0, reports: 0 });
    res.json({
      date,
      summary: {
        total_workers: workers.length,
        total_hours: Math.round(totals.hours * 100) / 100,
        total_quantity: totals.quantity,
        total_reports: totals.reports,
        active_work_orders: workOrders.length,
        active_instances: instances.length,
      },
      workers: workers.map((worker) => ({
        user_id: worker.worker_id,
        full_name: worker.full_name || `User #${worker.worker_id}`,
        total_hours: Math.round(worker.total_hours * 100) / 100,
        total_qty: worker.total_qty,
        report_count: worker.report_count,
        wo_count: worker.wo_count,
      })),
      work_orders: workOrders.map((workOrder) => ({
        id: workOrder.id,
        code: workOrder.wo_code,
        title: workOrder.title,
        status: workOrder.status,
        equipment: workOrder.instance_code
          ? { id: workOrder.equipment_instance_id, code: workOrder.instance_code, name: workOrder.instance_name }
          : null,
      })),
      instances: instances.map((instance) => ({ id: instance.id, code: instance.instance_code, name: instance.instance_name, status: instance.status })),
    });
  }));
}

module.exports = { registerWorkerPerformance };
