"use strict";
const { wrap } = require('../../middleware/asyncHandler');
const { ApiError } = require('../../app/errors');
const { makeHelpers } = require('./_helpers');
const { compileCron, executeScheduledReport, startScheduler } = require('./scheduler');
const { KEY_COMPONENT_PRICE_MULTIPLIER } = require('../cost/units');
// services/reportService/reportService.js
// 报表中心: 计划报表 / 即时生成 / CSV导出 / 调度管理
// Author: 三狗子 | Date: 2026-06-26

function register(app, db) {
  const { all, get, run } = makeHelpers(db);

  const tableCache = new Map();
  function tableExists(table) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return false;
    if (!tableCache.has(table)) {
      tableCache.set(table, !!get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", table));
    }
    return tableCache.get(table);
  }

  function safeAll(sql, params = []) {
    try {
      return all(sql, params);
    } catch (_error) {
      return [];
    }
  }

  // ====== 建表 ======
  run("CREATE TABLE IF NOT EXISTS scheduled_reports (id INTEGER PRIMARY KEY, report_name TEXT NOT NULL, report_type TEXT, schedule_cron TEXT, recipients TEXT, filters TEXT, format TEXT DEFAULT 'json', is_active INTEGER DEFAULT 1, last_run_at TEXT, created_at TEXT DEFAULT (datetime('now')))");
  run("CREATE TABLE IF NOT EXISTS report_history (id INTEGER PRIMARY KEY, report_id INTEGER, run_at TEXT DEFAULT (datetime('now')), status TEXT, output_data TEXT, error_msg TEXT)");

  // Helper: generate report data
  function generateReport(type, filters) {
    const { instance_id, from, to, limit } = filters || {};
    switch (type) {
      case "production_daily":
      case "daily_production": {
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
        const fromDate = from || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 10);
        const toDate = to || new Date().toISOString().slice(0, 10);
        const rows = tableExists("qc_inspections")
          ? safeAll(`SELECT qc.inspection_type, qc.result, qc.inspection_date, qc.work_order_id,
                           qc.notes, ei.instance_code, ei.instance_name,
                           wo.wo_code, wo.title AS work_order_title
                    FROM qc_inspections qc
                    JOIN equipment_instances ei ON qc.equipment_instance_id = ei.id
                    LEFT JOIN work_orders wo ON qc.work_order_id = wo.id
                    WHERE qc.inspection_date >= ? AND qc.inspection_date <= ?${instance_id ? ' AND qc.equipment_instance_id = ?' : ''}
                    ORDER BY qc.inspection_date DESC
                    LIMIT ?`, [fromDate, toDate, ...(instance_id ? [Number(instance_id)] : []), parseInt(limit) || 500])
          : [];
        const pass = rows.filter(r => r.result === "pass").length;
        const fail = rows.filter(r => r.result === "fail").length;
        const summary = { total: rows.length, pass, fail, pass_rate: rows.length ? (pass / rows.length * 100).toFixed(1) + "%" : "0%" };
        return { type, summary, rows, generated_at: new Date().toISOString() };
      }
      case "oee_weekly": {
        const fromDate = from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const toDate = to || new Date().toISOString().slice(0, 10);
        const rows = tableExists("oee_shift_log")
          ? safeAll(`SELECT o.id, o.shift_date AS record_date, o.shift_name,
                           o.planned_minutes, o.operating_minutes, o.ideal_cycle_time,
                           o.total_output, o.good_output,
                           ei.instance_code,
                           ROUND(CASE WHEN o.planned_minutes > 0 THEN o.operating_minutes * 100.0 / o.planned_minutes ELSE 0 END, 1) AS availability,
                           ROUND(CASE WHEN o.operating_minutes > 0 AND o.ideal_cycle_time > 0 THEN o.total_output * o.ideal_cycle_time * 100.0 / o.operating_minutes ELSE 0 END, 1) AS performance,
                           ROUND(CASE WHEN o.total_output > 0 THEN o.good_output * 100.0 / o.total_output ELSE 0 END, 1) AS quality,
                           ROUND(
                             (CASE WHEN o.planned_minutes > 0 THEN o.operating_minutes * 1.0 / o.planned_minutes ELSE 0 END) *
                             (CASE WHEN o.operating_minutes > 0 AND o.ideal_cycle_time > 0 THEN o.total_output * o.ideal_cycle_time * 1.0 / o.operating_minutes ELSE 0 END) *
                             (CASE WHEN o.total_output > 0 THEN o.good_output * 1.0 / o.total_output ELSE 0 END) * 100,
                             1
                           ) AS oee
                    FROM oee_shift_log o
                    JOIN equipment_instances ei ON o.equipment_instance_id = ei.id
                    WHERE o.shift_date >= ? AND o.shift_date <= ?${instance_id ? ' AND o.equipment_instance_id = ?' : ''}
                    ORDER BY o.shift_date DESC
                    LIMIT ?`, [fromDate, toDate, ...(instance_id ? [Number(instance_id)] : []), parseInt(limit) || 500])
          : [];
        if (rows.length) {
          // 2026-11-09：OEE 汇总改为加权口径，避免简单平均掩盖大班次/大产量影响。
          const planned = rows.reduce((s, r) => s + Number(r.planned_minutes || 0), 0);
          const operating = rows.reduce((s, r) => s + Number(r.operating_minutes || 0), 0);
          const totalOutput = rows.reduce((s, r) => s + Number(r.total_output || 0), 0);
          const goodOutput = rows.reduce((s, r) => s + Number(r.good_output || 0), 0);
          const idealOutput = rows.reduce((s, r) => s + Number(r.total_output || 0) * Number(r.ideal_cycle_time || 0), 0);
          const weightedAvailability = planned > 0 ? operating * 100 / planned : 0;
          const weightedPerformance = operating > 0 ? idealOutput * 100 / operating : 0;
          const weightedQuality = totalOutput > 0 ? goodOutput * 100 / totalOutput : 0;
          const weightedOee = weightedAvailability * weightedPerformance * weightedQuality / 10000;
          const summary = {
            total: rows.length,
            avg_availability: weightedAvailability.toFixed(1) + "%",
            avg_performance: weightedPerformance.toFixed(1) + "%",
            avg_quality: weightedQuality.toFixed(1) + "%",
            avg_oee: weightedOee.toFixed(1) + "%",
            weighted: true,
          };
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
        // 2026-11-09：经营分析的项目成本必须与成本归集/偏差同口径。
        // 关键件按万元×10000，物料按实际价×BOM，人工优先台账，其他按台账并折算汇率。
        const hasFx = !!get("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_fx_rates'");
        const hasKeyView = !!get("SELECT name FROM sqlite_master WHERE type='view' AND name='v_instance_key_component_costs'");
        const fx = (alias) => hasFx ? `COALESCE((SELECT rate_to_cny FROM cost_fx_rates WHERE currency = ${alias}.currency), 1)` : "1";
        const keyActual = hasKeyView
          ? `COALESCE((SELECT SUM(v.quantity * COALESCE(v.actual_unit_price, v.estimated_unit_price) * ${KEY_COMPONENT_PRICE_MULTIPLIER})
                       FROM v_instance_key_component_costs v WHERE v.instance_id = ei.id), 0)`
          : "0";
        const keyEstimated = hasKeyView
          ? `COALESCE((SELECT SUM(v.quantity * v.estimated_unit_price * ${KEY_COMPONENT_PRICE_MULTIPLIER})
                       FROM v_instance_key_component_costs v WHERE v.instance_id = ei.id), 0)`
          : "0";
        const materialActual = `COALESCE((SELECT SUM(ib.quantity * COALESCE(NULLIF(m.actual_unit_price, 0), m.estimated_unit_price, 0))
                       FROM instance_bom ib JOIN materials m ON m.id = ib.material_id
                       WHERE ib.equipment_instance_id = ei.id AND COALESCE(ib.is_key_component, 0) = 0), 0)`;
        const materialEstimated = `COALESCE((SELECT SUM(ib.quantity * COALESCE(m.estimated_unit_price, 0))
                       FROM instance_bom ib JOIN materials m ON m.id = ib.material_id
                       WHERE ib.equipment_instance_id = ei.id AND COALESCE(ib.is_key_component, 0) = 0), 0)`;
        const ledgerSum = (types) => `COALESCE((SELECT SUM(pce.amount * ${fx("pce")})
                       FROM project_cost_entries pce
                       WHERE pce.equipment_instance_id = ei.id AND pce.deleted_at IS NULL
                         AND pce.status = 'posted' AND pce.cost_type IN (${types})), 0)`;
        const fromDate = filters?.from || null;
        const toDate = filters?.to || null;
        const laborLedger = ledgerSum("'labor'");
        const outsourcingLedger = ledgerSum("'outsourcing'");
        const depreciationLedger = ledgerSum("'depreciation'");
        const reworkLedger = ledgerSum("'rework'");
        const qualityLossLedger = ledgerSum("'quality_loss'");
        const otherLedger = ledgerSum("'outsourcing','depreciation','rework','quality_loss'");
        const periodLedger = fromDate && toDate
          ? `COALESCE((SELECT SUM(pce.amount * ${fx("pce")})
                       FROM project_cost_entries pce
                       WHERE pce.equipment_instance_id = ei.id AND pce.deleted_at IS NULL
                         AND pce.status = 'posted' AND pce.occurred_on >= ? AND pce.occurred_on <= ?), 0)`
          : "0";
        const laborHours = `COALESCE((SELECT SUM(wo.actual_hours) FROM work_orders wo WHERE wo.equipment_instance_id = ei.id), 0)`;
        const rateRow = get("SELECT value FROM system_settings WHERE key = 'labor_rate_per_hour'");
        const hourlyRate = Math.max(0, Number(rateRow?.value || process.env.LABOR_RATE_PER_HOUR || 200) || 200);
        const where = ["1=1"];
        const params = [];
        // 经营分析默认排除演练/演示机，避免其异常合同金额污染汇总。
        if (String(filters?.include_demo) !== "true" && !instance_id) {
          where.push("ei.instance_code NOT LIKE 'TBM-DEMO%' AND ei.instance_code NOT LIKE 'DEMO%' AND ei.instance_name NOT LIKE '%演练%' AND ei.instance_name NOT LIKE '%演示%'");
        }
        if (instance_id) { where.push("ei.id = ?"); params.push(Number(instance_id)); }
        const periodParams = fromDate && toDate ? [fromDate, toDate] : [];
        const rows = safeAll(`SELECT ei.id, ei.instance_code, ei.instance_name, ei.contract_no,
          ei.contract_amount, ei.contract_amount_unit,
          CASE WHEN COALESCE(ei.contract_amount_unit, 'yuan') IN ('wan','万元') THEN COALESCE(ei.contract_amount,0) * 10000
               ELSE COALESCE(ei.contract_amount,0) END AS contract_yuan,
          ${materialEstimated} AS material_estimated,
          ${materialActual} AS material_cost,
          ${keyEstimated} AS key_component_estimated,
          ${keyActual} AS key_component_cost,
          ${laborHours} AS labor_hours,
          ${laborLedger} AS labor_ledger_cost,
          ${outsourcingLedger} AS outsourcing_cost,
          ${depreciationLedger} AS depreciation_cost,
          ${reworkLedger} AS rework_cost,
          ${qualityLossLedger} AS quality_loss_cost,
          ${otherLedger} AS other_cost,
          ${periodLedger} AS period_cost
          FROM equipment_instances ei
          WHERE ${where.join(" AND ")}
          ORDER BY contract_yuan DESC`, [...periodParams, ...params]);
        const enriched = rows.map((row) => {
          const laborCost = Number(row.labor_ledger_cost || 0) > 0
            ? Number(row.labor_ledger_cost)
            : Number(row.labor_hours || 0) * hourlyRate;
          const totalCost = Math.round((Number(row.material_cost || 0) + Number(row.key_component_cost || 0) + laborCost + Number(row.other_cost || 0)) * 100) / 100;
          const contractYuan = Number(row.contract_yuan || 0);
          const margin = Math.round((contractYuan - totalCost) * 100) / 100;
          return {
            ...row,
            labor_cost: Math.round(laborCost * 100) / 100,
            labor_cost_source: Number(row.labor_ledger_cost || 0) > 0 ? "ledger" : "hours_rate",
            total_cost: totalCost,
            gross_margin: margin,
            margin_pct: contractYuan > 0 ? Math.round((margin / contractYuan) * 10000) / 100 : null,
            period_cost: Math.round(Number(row.period_cost || 0) * 100) / 100,
          };
        });
        const allSummary = {
          total_projects: enriched.length,
          total_contract: enriched.reduce((sum, row) => sum + Number(row.contract_yuan || 0), 0),
          total_actual_cost: enriched.reduce((sum, row) => sum + Number(row.total_cost || 0), 0),
          total_period_cost: enriched.reduce((sum, row) => sum + Number(row.period_cost || 0), 0),
          total_gross_margin: enriched.reduce((sum, row) => sum + Number(row.gross_margin || 0), 0),
          // 兼容旧字段：按真实类别拆分，不再把“其他成本”塞进外协
          total_material_cost: enriched.reduce((sum, row) => sum + Number(row.material_cost || 0), 0),
          total_labor_cost: enriched.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0),
          total_outsourcing_cost: enriched.reduce((sum, row) => sum + Number(row.outsourcing_cost || 0), 0),
          total_depreciation_cost: enriched.reduce((sum, row) => sum + Number(row.depreciation_cost || 0), 0),
          total_rework_cost: enriched.reduce((sum, row) => sum + Number(row.rework_cost || 0), 0),
          total_quality_loss_cost: enriched.reduce((sum, row) => sum + Number(row.quality_loss_cost || 0), 0),
          total_other_cost: enriched.reduce((sum, row) => sum + Number(row.other_cost || 0), 0),
          total_loss_cost: enriched.reduce((sum, row) => sum + Number(row.rework_cost || 0) + Number(row.quality_loss_cost || 0), 0),
        };
        allSummary.total_margin_pct = allSummary.total_contract > 0
          ? Math.round((allSummary.total_gross_margin / allSummary.total_contract) * 10000) / 100
          : null;
        const maxRows = Math.min(parseInt(limit) || 100, 500);
        return { type, summary: allSummary, rows: enriched.slice(0, maxRows), returned_projects: Math.min(enriched.length, maxRows), generated_at: new Date().toISOString() };
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
      { type: "cost_summary", name: "成本汇总", description: "项目合同金额与全口径成本/毛利对比（默认不含演练机）" }
    ]);
  }));

  // ====== 即时生成报表 ======
  app.post("/api/reports/generate", wrap((req, res) => {
    const type = req.body.type || req.body.report_type;
    const filters = req.body.filters || {
      instance_id: req.body.instance_id || req.body.equipment_instance_id,
      from: req.body.from || req.body.date_from,
      to: req.body.to || req.body.date_to,
    };
    if (!type) throw ApiError.validation("type 必填");
    const data = generateReport(type, filters);
    res.json(data);
  }));

  // ====== 导出CSV ======
  app.post("/api/reports/export", wrap((req, res) => {
    const type = req.body.type || req.body.report_type;
    const filters = req.body.filters || req.body.data?.filters || {};
    const format = req.body.format || "csv";
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
    compileCron(schedule_cron || "0 8 * * *");
    const r = run("INSERT INTO scheduled_reports (report_name, report_type, schedule_cron, recipients, filters, format, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [report_name, report_type, schedule_cron || null, recipients || null, filters ? JSON.stringify(filters) : null, format || "json", is_active !== undefined ? (is_active ? 1 : 0) : 1]);
    res.status(201).json(get("SELECT * FROM scheduled_reports WHERE id = ?", Number(r.lastInsertRowid)));
  }));

  app.put("/api/reports/scheduled/:id", wrap((req, res) => {
    const row = get("SELECT * FROM scheduled_reports WHERE id = ?", req.params.id);
    if (!row) throw ApiError.notFound("报表不存在");
    const { report_name, report_type, schedule_cron, recipients, filters, format, is_active } = req.body;
    if (schedule_cron !== undefined) compileCron(schedule_cron);
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

  app.post("/api/reports/scheduled/:id/run-now", wrap((req, res) => {
    const report = get("SELECT * FROM scheduled_reports WHERE id = ?", req.params.id);
    if (!report) throw ApiError.notFound("报表不存在");
    const result = executeScheduledReport(db, report, generateReport);
    if (result.status === "failed") throw ApiError.unprocessable("报表执行失败: " + result.error);
    res.json(result);
  }));

  // ====== 报表执行历史 ======
  app.get("/api/reports/history", wrap((req, res) => {
    const { report_id, limit } = req.query;
    let sql = `SELECT h.*, s.report_name, s.report_type
      FROM report_history h LEFT JOIN scheduled_reports s ON s.id=h.report_id`;
    const params = [];
    const conditions = [];
    if (report_id) { conditions.push("h.report_id = ?"); params.push(report_id); }
    if (req.query.report_name) { conditions.push("s.report_name = ?"); params.push(req.query.report_name); }
    if (req.query.status) { conditions.push("h.status = ?"); params.push(req.query.status); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY run_at DESC LIMIT ?";
    params.push(parseInt(limit) || 50);
    res.json(all(sql, params));
  }));

  startScheduler(db, generateReport);
}

module.exports = { register };
