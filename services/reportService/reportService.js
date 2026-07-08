"use strict";
const { wrap } = require('../../middleware/asyncHandler');
const { ApiError } = require('../../app/errors');
const { makeHelpers } = require('./_helpers');
// services/reportService/reportService.js
// 报表中心: 计划报表 / 即时生成 / CSV导出 / 调度管理
// Author: 三狗子 | Date: 2026-06-26

function register(app, db) {
  const { all, get, run } = makeHelpers(db);

  // ====== 建表 ======
  run("CREATE TABLE IF NOT EXISTS scheduled_reports (id INTEGER PRIMARY KEY, report_name TEXT NOT NULL, report_type TEXT, schedule_cron TEXT, recipients TEXT, filters TEXT, format TEXT DEFAULT 'json', is_active INTEGER DEFAULT 1, last_run_at TEXT, created_at TEXT DEFAULT (datetime('now')))");
  run("CREATE TABLE IF NOT EXISTS report_history (id INTEGER PRIMARY KEY, report_id INTEGER, run_at TEXT DEFAULT (datetime('now')), status TEXT, output_data TEXT, error_msg TEXT)");

  // Helper: generate report data
  function generateReport(type, filters) {
    const { instance_id, from, to, limit } = filters || {};
    switch (type) {
      case "production_daily": {
        let sql = `SELECT wo.wo_code, wo.title, wo.status, wo.planned_start, wo.planned_end, wo.actual_hours, ei.instance_code, ei.instance_name
          FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE 1=1`;
        const params = [];
        if (instance_id) { sql += " AND ei.id = ?"; params.push(instance_id); }
        if (from) { sql += " AND wo.planned_start >= ?"; params.push(from); }
        if (to) { sql += " AND wo.planned_start <= ?"; params.push(to); }
        sql += " ORDER BY wo.planned_start DESC LIMIT ?";
        params.push(parseInt(limit) || 500);
        const rows = all(sql, params);
        const summary = { total: rows.length, completed: rows.filter(r => r.status === "completed").length, in_progress: rows.filter(r => r.status === "in_progress").length, pending: rows.filter(r => r.status === "pending").length };
        return { type, summary, rows, generated_at: new Date().toISOString() };
      }
      case "quality_monthly": {
        const sql = `SELECT qc.inspection_type, qc.result, qc.inspection_date, ei.instance_code, m.material_name
          FROM qc_inspections qc JOIN equipment_instances ei ON qc.equipment_instance_id = ei.id LEFT JOIN materials m ON qc.material_id = m.id
          WHERE 1=1`;
        const params = [];
        if (from) { params.push(from); params.push(to || new Date().toISOString().slice(0,10)); }
        else { params.push(new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,10)); params.push(new Date().toISOString().slice(0,10)); }
        const rows = all(sql + " AND qc.inspection_date >= ? AND qc.inspection_date <= ? ORDER BY qc.inspection_date DESC LIMIT ?", [...params, parseInt(limit) || 500]);
        const pass = rows.filter(r => r.result === "pass").length;
        const fail = rows.filter(r => r.result === "fail").length;
        const summary = { total: rows.length, pass, fail, pass_rate: rows.length ? (pass / rows.length * 100).toFixed(1) + "%" : "0%" };
        return { type, summary, rows, generated_at: new Date().toISOString() };
      }
      case "oee_weekly": {
        const fromDate = from || new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
        const toDate = to || new Date().toISOString().slice(0,10);
        const rows = all("SELECT o.*, ei.instance_code FROM oee_records o JOIN equipment_instances ei ON o.equipment_instance_id = ei.id WHERE o.record_date >= ? AND o.record_date <= ? ORDER BY o.record_date DESC LIMIT ?", fromDate, toDate, parseInt(limit) || 500);
        if (rows.length) {
          const avgAvailability = rows.reduce((s,r) => s + (r.availability || 0), 0) / rows.length;
          const avgPerformance = rows.reduce((s,r) => s + (r.performance || 0), 0) / rows.length;
          const avgQuality = rows.reduce((s,r) => s + (r.quality || 0), 0) / rows.length;
          const summary = { total: rows.length, avg_availability: avgAvailability.toFixed(1) + "%", avg_performance: avgPerformance.toFixed(1) + "%", avg_quality: avgQuality.toFixed(1) + "%", avg_oee: (avgAvailability * avgPerformance * avgQuality / 10000).toFixed(1) + "%" };
          return { type, summary, rows, generated_at: new Date().toISOString() };
        }
        return { type, summary: { total: 0 }, rows: [], generated_at: new Date().toISOString() };
      }
      case "inventory_snapshot": {
        const rows = all(`SELECT m.material_code, m.material_name, m.spec, m.unit, m.safety_stock,
          COALESCE(SUM(CASE WHEN i.status='available' THEN i.quantity ELSE 0 END),0) AS available_qty,
          COALESCE(SUM(i.quantity),0) AS total_qty
          FROM materials m LEFT JOIN material_lots ml ON ml.material_id=m.id LEFT JOIN inventory i ON i.material_lot_id=ml.id
          GROUP BY m.id ORDER BY available_qty ASC LIMIT ?`, parseInt(limit) || 500);
        const lowStock = rows.filter(r => r.available_qty < (r.safety_stock || 0));
        const summary = { total_materials: rows.length, low_stock_count: lowStock.length, total_available: rows.reduce((s,r) => s + r.available_qty, 0) };
        return { type, summary, rows, generated_at: new Date().toISOString() };
      }
      case "cost_summary": {
        const rows = all(`SELECT ei.instance_code, ei.instance_name, ei.contract_amount,
          COALESCE((SELECT SUM(mc.total_cost) FROM material_costs mc WHERE mc.equipment_instance_id=ei.id), 0) AS material_cost,
          COALESCE((SELECT SUM(wo.actual_hours * COALESCE(wo.hourly_rate, 200)) FROM work_orders wo WHERE wo.equipment_instance_id=ei.id), 0) AS labor_cost
          FROM equipment_instances ei ORDER BY ei.contract_amount DESC LIMIT ?`, parseInt(limit) || 100);
        const summary = { total_projects: rows.length, total_contract: rows.reduce((s,r) => s + (r.contract_amount || 0), 0), total_material_cost: rows.reduce((s,r) => s + (r.material_cost || 0), 0), total_labor_cost: rows.reduce((s,r) => s + (r.labor_cost || 0), 0) };
        return { type, summary, rows, generated_at: new Date().toISOString() };
      }
      default:
        throw ApiError.validation("未知报表类型: " + type);
    }
  }

  function toCSV(data) {
    if (!data || !data.rows || !data.rows.length) return "";
    const headers = Object.keys(data.rows[0]);
    const lines = [headers.join(",")];
    for (const row of data.rows) {
      lines.push(headers.map(h => { const v = row[h]; return v !== null && v !== undefined ? '"' + String(v).replace(/"/g, '""') + '"' : ""; }).join(","));
    }
    return lines.join("\n");
  }

  // ====== 可用报表类型 ======
  app.get("/api/reports/types", wrap((_req, res) => {
    res.json([
      { type: "production_daily", name: "生产日报", description: "工单状态、工时、进度汇总" },
      { type: "quality_monthly", name: "质量月报", description: "质检结果、合格率统计" },
      { type: "oee_weekly", name: "OEE周报", description: "设备综合效率趋势" },
      { type: "inventory_snapshot", name: "库存快照", description: "当前库存状态与低库存预警" },
      { type: "cost_summary", name: "成本汇总", description: "项目合同金额与物料/人工成本对比" }
    ]);
  }));

  // ====== 即时生成报表 ======
  app.post("/api/reports/generate", wrap((req, res) => {
    const { type, filters } = req.body;
    if (!type) throw ApiError.validation("type 必填");
    const data = generateReport(type, filters);
    res.json(data);
  }));

  // ====== 导出CSV ======
  app.post("/api/reports/export", wrap((req, res) => {
    const { type, filters, format } = req.body;
    if (!type) throw ApiError.validation("type 必填");
    const data = generateReport(type, filters);
    if (format === "csv" || format === "excel") {
      const csv = toCSV(data);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"" + type + "_" + new Date().toISOString().slice(0,10) + ".csv\"");
      res.send("\uFEFF" + csv);
    } else {
      res.json(data);
    }
  }));

  // ====== 计划报表CRUD ======
  app.get("/api/reports/scheduled", wrap((_req, res) => {
    res.json(all("SELECT * FROM scheduled_reports ORDER BY created_at DESC"));
  }));

  app.post("/api/reports/scheduled", wrap((req, res) => {
    const { report_name, report_type, schedule_cron, recipients, filters, format, is_active } = req.body;
    if (!report_name || !report_type) throw ApiError.validation("report_name/report_type 必填");
    const r = run("INSERT INTO scheduled_reports (report_name, report_type, schedule_cron, recipients, filters, format, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [report_name, report_type, schedule_cron || null, recipients || null, filters ? JSON.stringify(filters) : null, format || "json", is_active !== undefined ? (is_active ? 1 : 0) : 1]);
    res.status(201).json(get("SELECT * FROM scheduled_reports WHERE id = ?", Number(r.lastInsertRowid)));
  }));

  app.put("/api/reports/scheduled/:id", wrap((req, res) => {
    const row = get("SELECT * FROM scheduled_reports WHERE id = ?", req.params.id);
    if (!row) throw ApiError.notFound("报表不存在");
    const { report_name, report_type, schedule_cron, recipients, filters, format, is_active } = req.body;
    const sets = [], params = [];
    if (report_name !== undefined) { sets.push("report_name = ?"); params.push(report_name); }
    if (report_type !== undefined) { sets.push("report_type = ?"); params.push(report_type); }
    if (schedule_cron !== undefined) { sets.push("schedule_cron = ?"); params.push(schedule_cron); }
    if (recipients !== undefined) { sets.push("recipients = ?"); params.push(recipients); }
    if (filters !== undefined) { sets.push("filters = ?"); params.push(typeof filters === "string" ? filters : JSON.stringify(filters)); }
    if (format !== undefined) { sets.push("format = ?"); params.push(format); }
    if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active ? 1 : 0); }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    params.push(req.params.id);
    run("UPDATE scheduled_reports SET " + sets.join(", ") + " WHERE id = ?", params);
    res.json({ ok: true });
  }));

  app.delete("/api/reports/scheduled/:id", wrap((req, res) => {
    if (!get("SELECT id FROM scheduled_reports WHERE id = ?", req.params.id)) throw ApiError.notFound("报表不存在");
    run("DELETE FROM scheduled_reports WHERE id = ?", req.params.id);
    res.json({ ok: true });
  }));

  // ====== 报表执行历史 ======
  app.get("/api/reports/history", wrap((req, res) => {
    const { report_id, limit } = req.query;
    let sql = "SELECT * FROM report_history";
    const params = [];
    if (report_id) { sql += " WHERE report_id = ?"; params.push(report_id); }
    sql += " ORDER BY run_at DESC LIMIT ?";
    params.push(parseInt(limit) || 50);
    res.json(all(sql, params));
  }));
}

module.exports = { register };
