"use strict";
const { ApiError } = require('../app/errors');
// services/processHoursService.js
const { wrap } = require("../middleware/asyncHandler");
// 工时定额 + 工序级报工明细
//   GET /api/process-hours/worker-performance?from=Y&to=Z  工人效率看板
//   GET /api/process-hours/overtime?from=Y&to=Z            加班追踪
//   GET /api/process-hours/daily-summary?date=YYYY-MM-DD   每日生产汇总
// Author: Codex | Date: 2026-06-26

function runMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_standard_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL,
      work_type TEXT NOT NULL DEFAULT 'assembly',
      standard_hours REAL NOT NULL DEFAULT 0,
      worker_count INTEGER NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'h',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(process_node_id, work_type)
    );
    CREATE TABLE IF NOT EXISTS work_report_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      operation_id INTEGER,
      process_node_id INTEGER,
      worker_id INTEGER,
      work_type TEXT NOT NULL DEFAULT 'assembly',
      hours_spent REAL NOT NULL DEFAULT 0,
      quantity_completed INTEGER DEFAULT 0,
      quantity_total INTEGER,
      completion_pct REAL,
      quality_result TEXT DEFAULT 'pass',
      start_time TEXT,
      end_time TEXT,
      workstation TEXT,
      notes TEXT,
      reported_by INTEGER,
      reported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS process_node_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_node_id INTEGER NOT NULL UNIQUE,
      standard_hours_assembly REAL DEFAULT 0,
      standard_hours_welding REAL DEFAULT 0,
      standard_hours_machining REAL DEFAULT 0,
      standard_hours_testing REAL DEFAULT 0,
      estimated_workers INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wrd_wo ON work_report_details(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_wrd_worker ON work_report_details(worker_id);
    CREATE INDEX IF NOT EXISTS idx_wrd_node ON work_report_details(process_node_id);
    CREATE INDEX IF NOT EXISTS idx_psh_node ON process_standard_hours(process_node_id);
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p||[])),
    get: (sql, p) => db.prepare(sql).get(...(p||[])),
    run: (sql, p) => db.prepare(sql).run(...(p||[])),
  };
}

// === 工时定额管理 ===
function registerStandardHours(app, db) {
  const { all, get, run } = makeHelpers(db);

  app.get("/api/process/nodes/:id/hours", wrap((req, res) => {
    const node = get("SELECT id, operation_name, operation_name FROM process_nodes WHERE id=?", [req.params.id]);
    if (!node) throw ApiError.notFound("Process node not found")
    const hours = all("SELECT * FROM process_standard_hours WHERE process_node_id=? ORDER BY work_type", [req.params.id]);
    const sum = get("SELECT SUM(standard_hours*worker_count) AS total FROM process_standard_hours WHERE process_node_id=?", [req.params.id]);
    res.json({ node, standard_hours: hours, total_man_hours: sum?.total||0 });
  }));

  app.post("/api/process/nodes/:id/hours", wrap((req, res) => {
    const { work_type, standard_hours, worker_count, description } = req.body;
    if (!work_type || standard_hours == null) throw ApiError.validation("work_type and standard_hours required")
    run("INSERT OR REPLACE INTO process_standard_hours (process_node_id, work_type, standard_hours, worker_count, description, updated_at) VALUES (?,?,?,?,?,datetime('now'))",
      [req.params.id, work_type, standard_hours, worker_count||1, description||null]);
    res.json({ success: true, process_node_id: parseInt(req.params.id), work_type, standard_hours });
  }));

  app.delete("/api/process/nodes/:id/hours/:workType", wrap((req, res) => {
    run("DELETE FROM process_standard_hours WHERE process_node_id=? AND work_type=?", [req.params.id, req.params.workType]);
    res.json({ success: true });
  }));

  app.put("/api/process/nodes/:id/hours", wrap((req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) throw ApiError.validation("Body must be array of {work_type, standard_hours, worker_count}")
    run("DELETE FROM process_standard_hours WHERE process_node_id=?", [req.params.id]);
    const ins = db.prepare("INSERT INTO process_standard_hours (process_node_id, work_type, standard_hours, worker_count, description) VALUES (?,?,?,?,?)");
    const tx = db.transaction(() => { items.forEach(i => ins.run(req.params.id, i.work_type, i.standard_hours, i.worker_count||1, i.description||null)); });
    tx();
    res.json({ success: true, count: items.length });
  }));

  app.get("/api/process/hours-summary", wrap((req, res) => {
    const { instance_id } = req.query;
    if (!instance_id) throw ApiError.validation("instance_id required")
    const rows = all(
      "SELECT pn.id, pn.operation_name, psh.work_type, psh.standard_hours, psh.worker_count, (psh.standard_hours*psh.worker_count) AS man_hours FROM process_nodes pn LEFT JOIN process_standard_hours psh ON pn.id=psh.process_node_id WHERE pn.equipment_instance_id=? ORDER BY pn.operation_name, psh.work_type",
      [instance_id]
    );
    let totalManHours = 0;
    rows.forEach(r => { if (r.man_hours) totalManHours += r.man_hours; });
    res.json({ instance_id, nodes: rows.length, total_man_hours: Math.round(totalManHours*100)/100, details: rows });
  }));
}

// === 工序报工 ===
function registerWorkReport(app, db, auth) {
  const { all, get, run } = makeHelpers(db);

  app.post("/api/work-reports", wrap((req, res) => {
    const { work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, quality_result, start_time, end_time, workstation, notes } = req.body;
    if (!work_order_id || hours_spent == null) throw ApiError.validation("work_order_id and hours_spent required")

    const r = run(
      "INSERT INTO work_report_details (work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, completion_pct, quality_result, start_time, end_time, workstation, notes, reported_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [work_order_id, operation_id||null, process_node_id||null, worker_id||(req.user?.sub||null), work_type||"assembly", hours_spent, quantity_completed||0, quantity_total||null,
       quantity_total ? Math.round(quantity_completed/quantity_total*100) : null,
       quality_result||"pass", start_time||null, end_time||null, workstation||null, notes||null, req.user?.sub||null]
    );

    const totalHours = get("SELECT SUM(hours_spent) AS total FROM work_report_details WHERE work_order_id=?", [work_order_id]);
    run("UPDATE work_orders SET actual_hours=?, updated_at=datetime('now') WHERE id=?", [totalHours?.total||hours_spent, work_order_id]);

    res.json({ id: r.lastInsertRowid, work_order_id, hours_spent });
  }));

  app.get("/api/work-reports", wrap((req, res) => {
    const { work_order_id, process_node_id, worker_id, start_date, end_date } = req.query;
    let sql = "SELECT wr.*, wo.wo_code, wo.title AS wo_title, pn.operation_name, u.full_name AS worker_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN process_nodes pn ON wr.process_node_id=pn.id LEFT JOIN users u ON wr.worker_id=u.id WHERE 1=1";
    const p = [];
    if (work_order_id) { sql += " AND wr.work_order_id=?"; p.push(work_order_id); }
    if (process_node_id) { sql += " AND wr.process_node_id=?"; p.push(process_node_id); }
    if (worker_id) { sql += " AND wr.worker_id=?"; p.push(worker_id); }
    if (start_date) { sql += " AND wr.reported_at>=?"; p.push(start_date); }
    if (end_date) { sql += " AND wr.reported_at<=?"; p.push(end_date); }
    sql += " ORDER BY wr.reported_at DESC LIMIT 500";
    res.json(all(sql, p));
  }));

  app.get("/api/work-reports/daily-summary", wrap((req, res) => {
    const { date } = req.query;
    const d = date || new Date().toISOString().substring(0,10);
    const rows = all(
      "SELECT wr.worker_id, u.full_name AS worker_name, wr.work_type, COUNT(*) AS report_count, SUM(wr.hours_spent) AS total_hours, SUM(wr.quantity_completed) AS total_qty FROM work_report_details wr LEFT JOIN users u ON wr.worker_id=u.id WHERE date(wr.reported_at)=? GROUP BY wr.worker_id, wr.work_type ORDER BY total_hours DESC",
      [d]
    );
    res.json({ date: d, workers: rows.length, details: rows });
  }));

  app.get("/api/process/nodes/:id/progress", wrap((req, res) => {
    const reports = all(
      "SELECT wr.*, wo.wo_code, u.full_name AS worker_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN users u ON wr.worker_id=u.id WHERE wr.process_node_id=? ORDER BY wr.reported_at DESC LIMIT 50",
      [req.params.id]
    );
    const stats = get(
      "SELECT SUM(hours_spent) AS total_hours, SUM(quantity_completed) AS total_qty, COUNT(*) AS report_count FROM work_report_details WHERE process_node_id=?",
      [req.params.id]
    );
    const stdHours = get("SELECT SUM(standard_hours*worker_count) AS total FROM process_standard_hours WHERE process_node_id=?", [req.params.id]);
    res.json({
      process_node_id: parseInt(req.params.id),
      total_hours_reported: stats?.total_hours||0,
      total_quantity_completed: stats?.total_qty||0,
      report_count: stats?.report_count||0,
      standard_man_hours: stdHours?.total||0,
      completion_pct: stdHours?.total > 0 ? Math.min(100, Math.round((stats?.total_hours||0) / stdHours.total * 100)) : 0,
      recent_reports: reports
    });
  }));
}

// === NEW: 工人绩效看板 ===
function registerWorkerPerformance(app, db) {
  const { all, get } = makeHelpers(db);

  // 工人效率看板
  app.get("/api/process-hours/worker-performance", wrap((req, res) => {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
    const dateTo = to || new Date().toISOString().slice(0, 10);

    // 按工人汇总：总工时、标准工时、任务数、平均质量
    const rows = all(
      `SELECT wr.worker_id, u.full_name, u.username,
              SUM(wr.hours_spent) AS total_hours,
              COUNT(DISTINCT wr.work_order_id) AS tasks_completed,
              SUM(CASE WHEN wr.quality_result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
              COUNT(*) AS total_reports,
              (SUM(wr.hours_spent) * 8.0) AS standard_hours_calc
       FROM work_report_details wr
       LEFT JOIN users u ON wr.worker_id = u.id
       WHERE wr.reported_at >= ? AND wr.reported_at <= ?
         AND wr.worker_id IS NOT NULL
       GROUP BY wr.worker_id
       ORDER BY total_hours DESC`,
      [dateFrom, dateTo + " 23:59:59"]
    );

    const workers = rows.map(r => {
      const stdHours = r.standard_hours_calc || 0;
      return {
        user_id: r.worker_id,
        full_name: r.full_name || ("User #" + r.worker_id),
        total_hours: Math.round(r.total_hours * 100) / 100,
        standard_hours: Math.round(stdHours * 100) / 100,
        efficiency_pct: stdHours > 0 ? Math.round(r.total_hours / stdHours * 10000) / 100 : 0,
        tasks_completed: r.tasks_completed,
        avg_quality_score: r.total_reports > 0 ? Math.round(r.pass_count / r.total_reports * 10000) / 100 : 0
      };
    });

    res.json({
      period: { from: dateFrom, to: dateTo },
      workers,
      count: workers.length
    });
  }));

  // 加班追踪
  app.get("/api/process-hours/overtime", wrap((req, res) => {
    const { from, to } = req.query;
    const dateFrom = from || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
    const dateTo = to || new Date().toISOString().slice(0, 10);

    // 按天按工人统计工时，超过8小时算加班
    const rows = all(
      `SELECT wr.worker_id, u.full_name, date(wr.reported_at) AS work_date,
              SUM(wr.hours_spent) AS daily_hours
       FROM work_report_details wr
       LEFT JOIN users u ON wr.worker_id = u.id
       WHERE wr.reported_at >= ? AND wr.reported_at <= ?
         AND wr.worker_id IS NOT NULL
       GROUP BY wr.worker_id, date(wr.reported_at)
       HAVING daily_hours > 8
       ORDER BY work_date DESC, daily_hours DESC`,
      [dateFrom, dateTo + " 23:59:59"]
    );

    const overtimeRecords = rows.map(r => ({
      user_id: r.worker_id,
      full_name: r.full_name || ("User #" + r.worker_id),
      date: r.work_date,
      daily_hours: Math.round(r.daily_hours * 100) / 100,
      overtime_hours: Math.round((r.daily_hours - 8) * 100) / 100,
      overtime_pct: Math.round((r.daily_hours - 8) / 8 * 10000) / 100
    }));

    // 汇总
    let totalOvertimeHours = 0;
    const byWorker = {};
    for (const rec of overtimeRecords) {
      totalOvertimeHours += rec.overtime_hours;
      if (!byWorker[rec.user_id]) {
        byWorker[rec.user_id] = { user_id: rec.user_id, full_name: rec.full_name, overtime_hours: 0, overtime_days: 0 };
      }
      byWorker[rec.user_id].overtime_hours += rec.overtime_hours;
      byWorker[rec.user_id].overtime_days++;
    }

    res.json({
      period: { from: dateFrom, to: dateTo },
      overtime_days: overtimeRecords.length,
      total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
      by_worker: Object.values(byWorker).sort((a, b) => b.overtime_hours - a.overtime_hours),
      records: overtimeRecords
    });
  }));

  // 每日生产汇总
  app.get("/api/process-hours/daily-summary", wrap((req, res) => {
    const { date } = req.query;
    if (!date) throw ApiError.validation("date required (YYYY-MM-DD)");

    // 当天的所有报工汇总，跨所有实例
    const workers = all(
      `SELECT wr.worker_id, u.full_name,
              COUNT(*) AS report_count,
              SUM(wr.hours_spent) AS total_hours,
              SUM(wr.quantity_completed) AS total_qty,
              COUNT(DISTINCT wr.work_order_id) AS wo_count
       FROM work_report_details wr
       LEFT JOIN users u ON wr.worker_id = u.id
       WHERE date(wr.reported_at) = ?
       GROUP BY wr.worker_id
       ORDER BY total_hours DESC`,
      [date]
    );

    // 当天涉及的工单
    const workOrders = all(
      `SELECT DISTINCT wo.id, wo.wo_code, wo.title, wo.status, wo.equipment_instance_id,
              ei.instance_code, ei.instance_name
       FROM work_report_details wr
       JOIN work_orders wo ON wr.work_order_id = wo.id
       LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
       WHERE date(wr.reported_at) = ?
       ORDER BY wo.id`,
      [date]
    );

    // 当天涉及的设备实例
    const instanceIds = [...new Set(workOrders.map(wo => wo.equipment_instance_id).filter(Boolean))];
    const instances = instanceIds.length > 0
      ? all(`SELECT id, instance_code, instance_name, status FROM equipment_instances WHERE id IN (${instanceIds.map(() => '?').join(',')})`, instanceIds)
      : [];

    // 汇总统计
    let totalHours = 0, totalQty = 0, totalReports = 0;
    for (const w of workers) {
      totalHours += w.total_hours || 0;
      totalQty += w.total_qty || 0;
      totalReports += w.report_count;
    }

    res.json({
      date,
      summary: {
        total_workers: workers.length,
        total_hours: Math.round(totalHours * 100) / 100,
        total_quantity: totalQty,
        total_reports: totalReports,
        active_work_orders: workOrders.length,
        active_instances: instances.length
      },
      workers: workers.map(w => ({
        user_id: w.worker_id,
        full_name: w.full_name || ("User #" + w.worker_id),
        total_hours: Math.round(w.total_hours * 100) / 100,
        total_qty: w.total_qty,
        report_count: w.report_count,
        wo_count: w.wo_count
      })),
      work_orders: workOrders.map(wo => ({
        id: wo.id,
        code: wo.wo_code,
        title: wo.title,
        status: wo.status,
        equipment: wo.instance_code ? { id: wo.equipment_instance_id, code: wo.instance_code, name: wo.instance_name } : null
      })),
      instances: instances.map(ei => ({
        id: ei.id,
        code: ei.instance_code,
        name: ei.instance_name,
        status: ei.status
      }))
    });
  }));
}

function register(app, db, auth) {
  runMigration(db);
  registerStandardHours(app, db);
  registerWorkReport(app, db, auth);
  registerWorkerPerformance(app, db);
  console.log("[processHoursService] Standard hours + work report + worker performance registered");
}

module.exports = { register };
