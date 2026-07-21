"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerWorkerPerformance(app, db) {
  const all = (sql, params) => db.prepare(sql).all(...(params || []));

  app.get("/api/process-hours/worker-performance", wrap((req, res) => {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
    const dateTo = to || new Date().toISOString().slice(0, 10);
    const rows = all(`
      SELECT wr.worker_id, u.full_name, u.username,
             SUM(wr.hours_spent) AS total_hours,
             COUNT(DISTINCT wr.work_order_id) AS tasks_completed,
             SUM(CASE WHEN wr.quality_result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
             COUNT(*) AS total_reports,
             (SUM(wr.hours_spent) * 8.0) AS standard_hours_calc
      FROM work_report_details wr
      LEFT JOIN users u ON wr.worker_id = u.id
      WHERE wr.reported_at >= ? AND wr.reported_at <= ? AND wr.worker_id IS NOT NULL
      GROUP BY wr.worker_id
      ORDER BY total_hours DESC
    `, [dateFrom, `${dateTo} 23:59:59`]);
    const workers = rows.map((row) => {
      const standardHours = row.standard_hours_calc || 0;
      return {
        user_id: row.worker_id,
        full_name: row.full_name || `User #${row.worker_id}`,
        total_hours: Math.round(row.total_hours * 100) / 100,
        standard_hours: Math.round(standardHours * 100) / 100,
        efficiency_pct: standardHours > 0 ? Math.round(row.total_hours / standardHours * 10000) / 100 : 0,
        tasks_completed: row.tasks_completed,
        avg_quality_score: row.total_reports > 0 ? Math.round(row.pass_count / row.total_reports * 10000) / 100 : 0,
      };
    });
    res.json({ period: { from: dateFrom, to: dateTo }, workers, count: workers.length });
  }));

  app.get("/api/process-hours/overtime", wrap((req, res) => {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
    const dateTo = to || new Date().toISOString().slice(0, 10);
    const rows = all(`
      SELECT wr.worker_id, u.full_name, date(wr.reported_at) AS work_date,
             SUM(wr.hours_spent) AS daily_hours
      FROM work_report_details wr
      LEFT JOIN users u ON wr.worker_id = u.id
      WHERE wr.reported_at >= ? AND wr.reported_at <= ? AND wr.worker_id IS NOT NULL
      GROUP BY wr.worker_id, date(wr.reported_at)
      HAVING daily_hours > 8
      ORDER BY work_date DESC, daily_hours DESC
    `, [dateFrom, `${dateTo} 23:59:59`]);
    const records = rows.map((row) => ({
      user_id: row.worker_id,
      full_name: row.full_name || `User #${row.worker_id}`,
      date: row.work_date,
      daily_hours: Math.round(row.daily_hours * 100) / 100,
      overtime_hours: Math.round((row.daily_hours - 8) * 100) / 100,
      overtime_pct: Math.round((row.daily_hours - 8) / 8 * 10000) / 100,
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
      overtime_days: records.length,
      total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
      by_worker: Object.values(byWorker).sort((left, right) => right.overtime_hours - left.overtime_hours),
      records,
    });
  }));

  app.get("/api/process-hours/daily-summary", wrap((req, res) => {
    const { date } = req.query;
    if (!date) throw ApiError.validation("date required (YYYY-MM-DD)");
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
