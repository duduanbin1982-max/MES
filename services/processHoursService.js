"use strict";
// services/processHoursService.js
// 工时与报工模块：工时定额 + 工序级报工 + 日汇总 + 完工进度 + 工人绩效/加班
//
// 2026-11-06 审计整改：
//   WH-1 报工参数校验（时长 0<h<=24、数量非负、完成率 0-100、工序归属）
//   WH-2 报工可撤销（DELETE）并重算工单 actual_hours
//   WH-3 工时定额校验（节点必须存在、标准工时 > 0、人数 1-100）
//   WH-4 日期默认/过滤用本地日期（原 toISOString 会按 UTC 跨天）
//   WH-5 完工进度：优先用报工数量算完成率，并给出工时消耗率
const { ApiError } = require('../app/errors');
const { registerWorkerPerformance } = require("./processHours/analyticsRoutes");
const { wrap } = require("../middleware/asyncHandler");
const { todaySqlDate } = require("../shared/datetime");

const logger = require("../app/logger").createLogger("processHoursService");

const WORK_TYPES = ["assembly", "welding", "machining", "testing", "qc", "other"];
const QUALITY_RESULTS = ["pass", "fail", "rework"];
const MAX_SINGLE_REPORT_HOURS = Math.min(24, Number(process.env.MAX_SINGLE_REPORT_HOURS) || 24);
const MAX_STANDARD_HOURS = Math.max(1, Number(process.env.MAX_STANDARD_HOURS) || 10000);

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
    CREATE INDEX IF NOT EXISTS idx_wrd_wo ON work_report_details(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_wrd_worker ON work_report_details(worker_id);
    CREATE INDEX IF NOT EXISTS idx_wrd_node ON work_report_details(process_node_id);
    CREATE INDEX IF NOT EXISTS idx_psh_node ON process_standard_hours(process_node_id);
  `);
}

function makeHelpers(db) {
  return {
    all: (sql, p) => db.prepare(sql).all(...(p || [])),
    get: (sql, p) => db.prepare(sql).get(...(p || [])),
    run: (sql, p) => db.prepare(sql).run(...(p || [])),
  };
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) * 100) / 100));
}

function currentUserId(req) {
  return req && req.user ? (req.user.uid || req.user.sub || req.user.id || null) : null;
}

// === 工时定额管理 ===
function registerStandardHours(app, db) {
  const { all, get, run } = makeHelpers(db);

  function loadNode(rawId) {
    const nodeId = Number(rawId);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("process_node_id 必须是正整数");
    const node = get("SELECT id, operation_name, equipment_instance_id FROM process_nodes WHERE id=?", [nodeId]);
    if (!node) throw ApiError.notFound("工序节点不存在: " + rawId);
    return node;
  }

  function validateHoursPayload(body) {
    const workType = String(body.work_type || "assembly");
    if (!WORK_TYPES.includes(workType)) throw ApiError.validation("work_type 必须是: " + WORK_TYPES.join("/"));
    const standardHours = finiteNumber(body.standard_hours);
    if (standardHours === null || standardHours <= 0) throw ApiError.validation("standard_hours 必须 > 0");
    if (standardHours > MAX_STANDARD_HOURS) throw ApiError.validation("standard_hours 不能超过 " + MAX_STANDARD_HOURS);
    const workerCount = finiteNumber(body.worker_count == null ? 1 : body.worker_count);
    if (workerCount === null || !Number.isInteger(workerCount) || workerCount < 1 || workerCount > 100) {
      throw ApiError.validation("worker_count 必须是 1-100 的整数");
    }
    return { workType, standardHours, workerCount, description: body.description || null };
  }

  app.get("/api/process/nodes/:id/hours", wrap((req, res) => {
    const node = loadNode(req.params.id);
    const hours = all("SELECT * FROM process_standard_hours WHERE process_node_id=? ORDER BY work_type", [node.id]);
    const sum = get("SELECT SUM(standard_hours*worker_count) AS total FROM process_standard_hours WHERE process_node_id=?", [node.id]);
    res.json({ node, standard_hours: hours, total_man_hours: round2(sum ? sum.total : 0) });
  }));

  app.post("/api/process/nodes/:id/hours", wrap((req, res) => {
    const node = loadNode(req.params.id);
    const { workType, standardHours, workerCount, description } = validateHoursPayload(req.body || {});
    run("INSERT OR REPLACE INTO process_standard_hours (process_node_id, work_type, standard_hours, worker_count, description, updated_at) VALUES (?,?,?,?,?,datetime('now'))",
      [node.id, workType, standardHours, workerCount, description]);
    res.json({ success: true, process_node_id: node.id, work_type: workType, standard_hours: standardHours });
  }));

  app.delete("/api/process/nodes/:id/hours/:workType", wrap((req, res) => {
    const node = loadNode(req.params.id);
    run("DELETE FROM process_standard_hours WHERE process_node_id=? AND work_type=?", [node.id, req.params.workType]);
    res.json({ success: true });
  }));

  app.put("/api/process/nodes/:id/hours", wrap((req, res) => {
    const node = loadNode(req.params.id);
    const items = req.body;
    if (!Array.isArray(items)) throw ApiError.validation("Body must be array of {work_type, standard_hours, worker_count}");
    const validated = items.map((item) => validateHoursPayload(item || {}));
    const insert = db.prepare("INSERT INTO process_standard_hours (process_node_id, work_type, standard_hours, worker_count, description) VALUES (?,?,?,?,?)");
    const tx = db.transaction(() => {
      run("DELETE FROM process_standard_hours WHERE process_node_id=?", [node.id]);
      for (const item of validated) {
        insert.run(node.id, item.workType, item.standardHours, item.workerCount, item.description);
      }
    });
    tx();
    res.json({ success: true, count: validated.length });
  }));

  app.get("/api/process/hours-summary", wrap((req, res) => {
    const { instance_id } = req.query;
    if (!instance_id) throw ApiError.validation("instance_id required");
    const rows = all(
      "SELECT pn.id, pn.operation_name, psh.work_type, psh.standard_hours, psh.worker_count, (psh.standard_hours*psh.worker_count) AS man_hours FROM process_nodes pn LEFT JOIN process_standard_hours psh ON pn.id=psh.process_node_id WHERE pn.equipment_instance_id=? ORDER BY pn.operation_name, psh.work_type",
      [instance_id]
    );
    let totalManHours = 0;
    const nodeIds = new Set();
    rows.forEach((row) => {
      nodeIds.add(row.id);
      if (row.man_hours) totalManHours += Number(row.man_hours);
    });
    res.json({ instance_id: Number(instance_id), nodes: nodeIds.size, total_man_hours: round2(totalManHours), details: rows });
  }));
}

// === 工序报工 ===
function registerWorkReport(app, db, auth) {
  const { all, get, run } = makeHelpers(db);

  app.post("/api/work-reports", wrap((req, res) => {
    const body = req.body || {};
    const { work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, quality_result, start_time, end_time, workstation, notes } = body;

    // 2026-11-06（WH-1）：原来只校验 hours_spent != null，负工时/999 小时/不存在的工单都能写
    const workOrder = get("SELECT id, wo_code, equipment_instance_id FROM work_orders WHERE id=?", [work_order_id]);
    if (!workOrder) throw ApiError.notFound("工单不存在: " + work_order_id);

    const hours = finiteNumber(hours_spent);
    if (hours === null || hours <= 0) throw ApiError.validation("hours_spent 必须 > 0");
    if (hours > MAX_SINGLE_REPORT_HOURS) throw ApiError.validation("单次报工不能超过 " + MAX_SINGLE_REPORT_HOURS + " 小时");
    if (notes && String(notes).length > 1000) throw ApiError.validation("notes 不能超过 1000 字");

    const type = String(work_type || "assembly");
    if (!WORK_TYPES.includes(type)) throw ApiError.validation("work_type 必须是: " + WORK_TYPES.join("/"));
    const quality = String(quality_result || "pass");
    if (!QUALITY_RESULTS.includes(quality)) throw ApiError.validation("quality_result 必须是: " + QUALITY_RESULTS.join("/"));

    let node = null;
    if (process_node_id != null) {
      node = get("SELECT id, equipment_instance_id FROM process_nodes WHERE id=?", [process_node_id]);
      if (!node) throw ApiError.notFound("工序节点不存在: " + process_node_id);
      if (workOrder.equipment_instance_id && node.equipment_instance_id
        && Number(node.equipment_instance_id) !== Number(workOrder.equipment_instance_id)) {
        throw ApiError.validation("工序节点不属于该工单的装备实例");
      }
    }
    if (operation_id != null) {
      const operation = get("SELECT id FROM work_order_operations WHERE id=?", [operation_id]);
      if (!operation) throw ApiError.notFound("工单工序不存在: " + operation_id);
    }

    const completedQty = finiteNumber(quantity_completed == null ? 0 : quantity_completed);
    if (completedQty === null || completedQty < 0) throw ApiError.validation("quantity_completed 必须 >= 0");
    const totalQty = quantity_total == null ? null : finiteNumber(quantity_total);
    if (totalQty !== null && (totalQty < 0 || totalQty < completedQty)) throw ApiError.validation("quantity_total 必须 >= quantity_completed");
    const completionPct = totalQty && totalQty > 0 ? clampPercent((completedQty / totalQty) * 100) : null;

    const requestedWorker = worker_id == null ? null : Number(worker_id);
    let resolvedWorker = currentUserId(req);
    if (requestedWorker !== null) {
      if (!Number.isInteger(requestedWorker) || requestedWorker <= 0) throw ApiError.validation("worker_id 必须是正整数");
      const worker = get("SELECT id FROM users WHERE id=?", [requestedWorker]);
      if (!worker) throw ApiError.notFound("报工人不存在: " + requestedWorker);
      resolvedWorker = requestedWorker;
    }

    const transaction = db.transaction(() => {
      const result = run(
        "INSERT INTO work_report_details (work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, completion_pct, quality_result, start_time, end_time, workstation, notes, reported_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [workOrder.id, operation_id || null, node ? node.id : null, resolvedWorker, type, hours, completedQty, totalQty,
          completionPct, quality, start_time || null, end_time || null, workstation || null, notes || null, currentUserId(req)]
      );
      const totalHours = get("SELECT COALESCE(SUM(hours_spent),0) AS total FROM work_report_details WHERE work_order_id=?", [workOrder.id]);
      run("UPDATE work_orders SET actual_hours=?, updated_at=datetime('now') WHERE id=?", [round2(totalHours.total), workOrder.id]);
      return result;
    });
    const result = transaction();

    res.json({
      id: result.lastInsertRowid,
      work_order_id: workOrder.id,
      worker_id: resolvedWorker,
      hours_spent: hours,
      completion_pct: completionPct,
    });
  }));

  app.delete("/api/work-reports/:id", wrap((req, res) => {
    const report = get("SELECT * FROM work_report_details WHERE id=?", [req.params.id]);
    if (!report) throw ApiError.notFound("报工记录不存在: " + req.params.id);
    const transaction = db.transaction(() => {
      run("DELETE FROM work_report_details WHERE id=?", [report.id]);
      const totalHours = get("SELECT COALESCE(SUM(hours_spent),0) AS total FROM work_report_details WHERE work_order_id=?", [report.work_order_id]);
      run("UPDATE work_orders SET actual_hours=?, updated_at=datetime('now') WHERE id=?", [round2(totalHours.total), report.work_order_id]);
      return round2(totalHours.total);
    });
    const actualHours = transaction();
    res.json({ deleted: report.id, work_order_id: report.work_order_id, actual_hours: actualHours });
  }));

  app.get("/api/work-reports", wrap((req, res) => {
    const { work_order_id, process_node_id, worker_id, start_date, end_date } = req.query;
    let sql = "SELECT wr.*, wo.wo_code, wo.title AS wo_title, pn.operation_name, u.full_name AS worker_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN process_nodes pn ON wr.process_node_id=pn.id LEFT JOIN users u ON wr.worker_id=u.id WHERE 1=1";
    const p = [];
    if (work_order_id) { sql += " AND wr.work_order_id=?"; p.push(work_order_id); }
    if (process_node_id) { sql += " AND wr.process_node_id=?"; p.push(process_node_id); }
    if (worker_id) { sql += " AND wr.worker_id=?"; p.push(worker_id); }
    if (start_date) { sql += " AND wr.reported_at>=?"; p.push(String(start_date).length === 10 ? start_date + " 00:00:00" : start_date); }
    // 2026-11-06（WH-4）：日期过滤时 end_date 补足当天 23:59:59，原来只写日期会漏掉当天记录
    if (end_date) { sql += " AND wr.reported_at<=?"; p.push(String(end_date).length === 10 ? end_date + " 23:59:59" : end_date); }
    sql += " ORDER BY wr.reported_at DESC LIMIT 500";
    res.json(all(sql, p));
  }));

  app.get("/api/work-reports/daily-summary", wrap((req, res) => {
    const d = req.query.date || todaySqlDate();
    const rows = all(
      "SELECT wr.worker_id, u.full_name AS worker_name, wr.work_type, COUNT(*) AS report_count, SUM(wr.hours_spent) AS total_hours, SUM(wr.quantity_completed) AS total_qty FROM work_report_details wr LEFT JOIN users u ON wr.worker_id=u.id WHERE date(wr.reported_at)=? GROUP BY wr.worker_id, wr.work_type ORDER BY total_hours DESC",
      [d]
    );
    res.json({ date: d, workers: rows.length, details: rows });
  }));

  app.get("/api/process/nodes/:id/progress", wrap((req, res) => {
    const nodeId = Number(req.params.id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("process_node_id 必须是正整数");
    const reports = all(
      "SELECT wr.*, wo.wo_code, u.full_name AS worker_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN users u ON wr.worker_id=u.id WHERE wr.process_node_id=? ORDER BY wr.reported_at DESC LIMIT 50",
      [nodeId]
    );
    const stats = get(
      "SELECT SUM(hours_spent) AS total_hours, SUM(quantity_completed) AS total_qty, MAX(quantity_total) AS qty_total, COUNT(*) AS report_count FROM work_report_details WHERE process_node_id=?",
      [nodeId]
    );
    const stdHours = get("SELECT SUM(standard_hours*worker_count) AS total FROM process_standard_hours WHERE process_node_id=?", [nodeId]);
    const standardManHours = round2(stdHours ? stdHours.total : 0);
    const totalHours = round2(stats ? stats.total_hours : 0);
    const quantityCompleted = Number(stats ? stats.total_qty : 0) || 0;
    const quantityTotal = Number(stats ? stats.qty_total : 0) || 0;
    const hoursRatio = standardManHours > 0 ? clampPercent((totalHours / standardManHours) * 100) : 0;
    const quantityPct = quantityTotal > 0 ? clampPercent((quantityCompleted / quantityTotal) * 100) : null;
    res.json({
      process_node_id: nodeId,
      total_hours_reported: totalHours,
      total_quantity_completed: quantityCompleted,
      quantity_total: quantityTotal || null,
      report_count: Number(stats ? stats.report_count : 0) || 0,
      standard_man_hours: standardManHours,
      // 完成率优先用数量口径；没有数量数据时退化为工时消耗率（并单独返回 hours_ratio_pct）
      completion_pct: quantityPct === null ? hoursRatio : quantityPct,
      hours_ratio_pct: hoursRatio,
      recent_reports: reports,
    });
  }));
}

function register(app, db, auth) {
  runMigration(db);
  registerStandardHours(app, db);
  registerWorkReport(app, db, auth);
  registerWorkerPerformance(app, db);
  logger.info("[processHoursService] Standard hours + work report + worker performance registered");
}

module.exports = { register, WORK_TYPES, QUALITY_RESULTS, MAX_SINGLE_REPORT_HOURS };
