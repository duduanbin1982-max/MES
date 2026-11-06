"use strict";
// services/processHoursService.js
// 工时与报工：工时定额 + 工序报工（审批/月结/成本入账）+ 日汇总 + 完工进度 + 绩效/加班
//
// 2026-11-06 第二轮整改（P3 遗留全清）：
//   · 报工审批流：pending → approved / rejected；只有 approved 计入实际工时/绩效/日汇总
//   · 月结锁定：work_month_locks，锁定月份禁止新增/审批/撤销报工
//   · 工时日历：work_calendar（工作日/周末/节假日 + 标准工时），加班按日历阈值计算
//   · 报工工时 → project_cost_entries 人工成本自动入账（审批通过入账、驳回/撤销冲销）
//   · WH-9 口径统一：项目进度优先取报工工时（approved），无报工数据时回退工序执行工时
const { ApiError } = require('../app/errors');
const { registerWorkerPerformance } = require("./processHours/analyticsRoutes");
const { wrap } = require("../middleware/asyncHandler");
const { todaySqlDate } = require("../shared/datetime");

const logger = require("../app/logger").createLogger("processHoursService");

const WORK_TYPES = ["assembly", "welding", "machining", "testing", "qc", "other"];
const QUALITY_RESULTS = ["pass", "fail", "rework"];
const REPORT_STATUSES = ["pending", "approved", "rejected"];
const MAX_SINGLE_REPORT_HOURS = Math.min(24, Number(process.env.MAX_SINGLE_REPORT_HOURS) || 24);
const MAX_STANDARD_HOURS = Math.max(1, Number(process.env.MAX_STANDARD_HOURS) || 10000);
const DAY_TYPES = ["workday", "weekend", "holiday"];

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

function monthOf(dateStr) {
  const text = String(dateStr || "").replace("T", " ");
  return text.slice(0, 7);
}

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
  } catch (_error) {
    return false;
  }
}

// 报工状态过滤：老库没有 status 列时按"全部已通过"处理（迁移脚本会补列）
function approvedFilter(db) {
  return hasColumn(db, "work_report_details", "status") ? " AND wr.status = 'approved'" : "";
}

function getLaborRate(db) {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'labor_rate_per_hour'").get();
    const numeric = Number(row && row.value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  } catch (_error) { /* system_settings 可能不存在 */ }
  const envRate = Number(process.env.LABOR_RATE_PER_HOUR);
  return Number.isFinite(envRate) && envRate > 0 ? envRate : 200;
}

function getMonthLock(db, dateStr) {
  if (!hasTable(db, "work_month_locks")) return null;
  const month = monthOf(dateStr);
  if (!month) return null;
  return db.prepare("SELECT * FROM work_month_locks WHERE month=?").get(month) || null;
}

function ensureMonthUnlocked(db, dateStr) {
  const lock = getMonthLock(db, dateStr);
  if (lock) throw ApiError.validation(`报工月份 ${lock.month} 已月结锁定，不能新增/审批/撤销`);
}

function recomputeActualHours(db, workOrderId) {
  const clause = hasColumn(db, "work_report_details", "status") ? " AND status='approved'" : "";
  const row = db.prepare("SELECT COALESCE(SUM(hours_spent),0) AS total FROM work_report_details WHERE work_order_id=?" + clause).get(workOrderId);
  const total = round2(row.total);
  db.prepare("UPDATE work_orders SET actual_hours=?, updated_at=datetime('now') WHERE id=?").run(total, workOrderId);
  return total;
}

// 报工工时 → 人工成本台账（幂等：按 source_ref 先删后插；驳回/撤销时只删）
function syncLaborCost(db, report, workOrder, options) {
  if (!hasTable(db, "project_cost_entries")) return { skipped: "no_cost_table" };
  const sourceRef = `work_report:${report.id}:labor`;
  db.prepare("DELETE FROM project_cost_entries WHERE source_ref=?").run(sourceRef);
  if (options && options.remove) return { removed: true, source_ref: sourceRef };
  if (!workOrder || !workOrder.equipment_instance_id) return { skipped: "no_instance" };
  const rate = getLaborRate(db);
  const amount = round2(Number(report.hours_spent) * rate);
  const occurredOn = String(report.approved_at || report.reported_at || todaySqlDate()).slice(0, 10);
  const result = db.prepare(`INSERT INTO project_cost_entries
    (equipment_instance_id, work_order_id, cost_type, source_type, source_ref, description, amount, currency, occurred_on, status, notes, created_by)
    VALUES (?, ?, 'labor', 'work_report', ?, ?, ?, 'CNY', ?, 'posted', ?, ?)`)
    .run(workOrder.equipment_instance_id, workOrder.id, sourceRef,
      `报工人工成本 ${workOrder.wo_code}`, amount, occurredOn,
      `自动入账：${report.hours_spent}h × ${rate} 元/h`, report.worker_id || null);
  return { id: Number(result.lastInsertRowid), amount, rate, source_ref: sourceRef };
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
      for (const item of validated) insert.run(node.id, item.workType, item.standardHours, item.workerCount, item.description);
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

// === 工序报工（审批 / 月结 / 成本） ===
function registerWorkReport(app, db, auth) {
  const { all, get, run } = makeHelpers(db);
  const statusAware = hasColumn(db, "work_report_details", "status");

  app.post("/api/work-reports", wrap((req, res) => {
    const body = req.body || {};
    const { work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, quality_result, start_time, end_time, workstation, notes } = body;

    const workOrder = get("SELECT id, wo_code, equipment_instance_id, assigned_to FROM work_orders WHERE id=?", [work_order_id]);
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
      node = get("SELECT id, equipment_instance_id, operation_name FROM process_nodes WHERE id=?", [process_node_id]);
      if (!node) throw ApiError.notFound("工序节点不存在: " + process_node_id);
      if (workOrder.equipment_instance_id && node.equipment_instance_id
        && Number(node.equipment_instance_id) !== Number(workOrder.equipment_instance_id)) {
        throw ApiError.validation("工序节点不属于该工单的装备实例");
      }
    }
    if (operation_id != null && !get("SELECT id FROM work_order_operations WHERE id=?", [operation_id])) {
      throw ApiError.notFound("工单工序不存在: " + operation_id);
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
      if (!get("SELECT id FROM users WHERE id=?", [requestedWorker])) throw ApiError.notFound("报工人不存在: " + requestedWorker);
      resolvedWorker = requestedWorker;
    }

    // WH-11 月结：报工归属月份 = 报工时间所在月（默认当月），锁定后拒绝
    const reportDate = start_time ? String(start_time) : todaySqlDate();
    ensureMonthUnlocked(db, reportDate);

    const status = statusAware ? "pending" : null;
    const columns = "work_order_id, operation_id, process_node_id, worker_id, work_type, hours_spent, quantity_completed, quantity_total, completion_pct, quality_result, start_time, end_time, workstation, notes, reported_by" + (statusAware ? ", status" : "");
    const values = [workOrder.id, operation_id || null, node ? node.id : null, resolvedWorker, type, hours, completedQty, totalQty,
      completionPct, quality, start_time || null, end_time || null, workstation || null, notes || null, currentUserId(req)];
    if (statusAware) values.push(status);

    const result = run(`INSERT INTO work_report_details (${columns}) VALUES (${values.map(() => "?").join(",")})`, values);
    res.json({
      id: result.lastInsertRowid,
      work_order_id: workOrder.id,
      worker_id: resolvedWorker,
      hours_spent: hours,
      completion_pct: completionPct,
      status: status || "approved",
      message: statusAware ? "报工已提交，待审批（审批通过后计入实际工时与人工成本）" : "报工成功",
      actual_hours: get("SELECT actual_hours FROM work_orders WHERE id=?", [workOrder.id]).actual_hours,
    });
  }));

  app.put("/api/work-reports/:id/approve", wrap((req, res) => {
    const report = get("SELECT * FROM work_report_details WHERE id=?", [req.params.id]);
    if (!report) throw ApiError.notFound("报工记录不存在: " + req.params.id);
    if (!statusAware) throw ApiError.validation("当前数据库未启用报工审批（缺少 status 列，请执行迁移脚本）");
    ensureMonthUnlocked(db, report.reported_at || report.start_time || todaySqlDate());
    if (report.status === "approved") {
      return res.json({ ok: true, already: true, id: report.id, status: "approved" });
    }
    const workOrder = get("SELECT id, wo_code, equipment_instance_id FROM work_orders WHERE id=?", [report.work_order_id]);
    if (!workOrder) throw ApiError.notFound("报工关联的工单不存在");
    const tx = db.transaction(() => {
      run("UPDATE work_report_details SET status='approved', approved_by=?, approved_at=datetime('now'), reject_reason=NULL WHERE id=?",
        [currentUserId(req), report.id]);
      const updated = get("SELECT * FROM work_report_details WHERE id=?", [report.id]);
      const cost = syncLaborCost(db, updated, workOrder);
      const actualHours = recomputeActualHours(db, workOrder.id);
      return { updated, cost, actualHours };
    });
    const result = tx();
    res.json({
      ok: true,
      id: report.id,
      status: "approved",
      actual_hours: result.actualHours,
      cost_entry: result.cost,
    });
  }));

  app.put("/api/work-reports/:id/reject", wrap((req, res) => {
    const report = get("SELECT * FROM work_report_details WHERE id=?", [req.params.id]);
    if (!report) throw ApiError.notFound("报工记录不存在: " + req.params.id);
    if (!statusAware) throw ApiError.validation("当前数据库未启用报工审批（缺少 status 列）");
    ensureMonthUnlocked(db, report.reported_at || report.start_time || todaySqlDate());
    const reason = String((req.body || {}).reason || "").trim();
    if (!reason) throw ApiError.validation("驳回必须填写 reason");
    const workOrder = get("SELECT id, wo_code, equipment_instance_id FROM work_orders WHERE id=?", [report.work_order_id]);
    const tx = db.transaction(() => {
      run("UPDATE work_report_details SET status='rejected', approved_by=?, approved_at=datetime('now'), reject_reason=? WHERE id=?",
        [currentUserId(req), reason, report.id]);
      syncLaborCost(db, report, workOrder, { remove: true });
      const actualHours = recomputeActualHours(db, report.work_order_id);
      return actualHours;
    });
    const actualHours = tx();
    res.json({ ok: true, id: report.id, status: "rejected", reason, actual_hours: actualHours });
  }));

  app.delete("/api/work-reports/:id", wrap((req, res) => {
    const report = get("SELECT * FROM work_report_details WHERE id=?", [req.params.id]);
    if (!report) throw ApiError.notFound("报工记录不存在: " + req.params.id);
    if (statusAware && report.status === "approved") {
      ensureMonthUnlocked(db, report.reported_at || report.start_time || todaySqlDate());
    }
    const workOrder = get("SELECT id, wo_code, equipment_instance_id FROM work_orders WHERE id=?", [report.work_order_id]);
    const tx = db.transaction(() => {
      syncLaborCost(db, report, workOrder, { remove: true });
      run("DELETE FROM work_report_details WHERE id=?", [report.id]);
      return recomputeActualHours(db, report.work_order_id);
    });
    const actualHours = tx();
    res.json({ deleted: report.id, work_order_id: report.work_order_id, actual_hours: actualHours });
  }));

  app.get("/api/work-reports", wrap((req, res) => {
    const { work_order_id, process_node_id, worker_id, start_date, end_date, status } = req.query;
    let sql = "SELECT wr.*, wo.wo_code, wo.title AS wo_title, pn.operation_name, u.full_name AS worker_name, au.full_name AS approved_by_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN process_nodes pn ON wr.process_node_id=pn.id LEFT JOIN users u ON wr.worker_id=u.id LEFT JOIN users au ON wr.approved_by=au.id WHERE 1=1";
    const p = [];
    if (work_order_id) { sql += " AND wr.work_order_id=?"; p.push(work_order_id); }
    if (process_node_id) { sql += " AND wr.process_node_id=?"; p.push(process_node_id); }
    if (worker_id) { sql += " AND wr.worker_id=?"; p.push(worker_id); }
    if (status) { sql += " AND wr.status=?"; p.push(status); }
    if (start_date) { sql += " AND wr.reported_at>=?"; p.push(String(start_date).length === 10 ? start_date + " 00:00:00" : start_date); }
    if (end_date) { sql += " AND wr.reported_at<=?"; p.push(String(end_date).length === 10 ? end_date + " 23:59:59" : end_date); }
    sql += " ORDER BY wr.reported_at DESC LIMIT 500";
    res.json(all(sql, p));
  }));

  app.get("/api/work-reports/daily-summary", wrap((req, res) => {
    const d = req.query.date || todaySqlDate();
    const filter = approvedFilter(db);
    const rows = all(
      `SELECT wr.worker_id, u.full_name AS worker_name, wr.work_type, COUNT(*) AS report_count, SUM(wr.hours_spent) AS total_hours, SUM(wr.quantity_completed) AS total_qty
       FROM work_report_details wr LEFT JOIN users u ON wr.worker_id=u.id
       WHERE date(wr.reported_at)=?${filter} GROUP BY wr.worker_id, wr.work_type ORDER BY total_hours DESC`,
      [d]
    );
    res.json({ date: d, workers: rows.length, details: rows });
  }));

  app.get("/api/process/nodes/:id/progress", wrap((req, res) => {
    const nodeId = Number(req.params.id);
    if (!Number.isInteger(nodeId) || nodeId <= 0) throw ApiError.validation("process_node_id 必须是正整数");
    const filter = approvedFilter(db);
    const reports = all(
      `SELECT wr.*, wo.wo_code, u.full_name AS worker_name FROM work_report_details wr JOIN work_orders wo ON wr.work_order_id=wo.id LEFT JOIN users u ON wr.worker_id=u.id WHERE wr.process_node_id=?${filter} ORDER BY wr.reported_at DESC LIMIT 50`,
      [nodeId]
    );
    const stats = get(
      "SELECT SUM(hours_spent) AS total_hours, SUM(quantity_completed) AS total_qty, MAX(quantity_total) AS qty_total, COUNT(*) AS report_count FROM work_report_details WHERE process_node_id=?" + (statusAware ? " AND status='approved'" : ""),
      [nodeId]
    );
    const stdHours = get("SELECT SUM(standard_hours*worker_count) AS total FROM process_standard_hours WHERE process_node_id=?", [nodeId]);
    const standardManHours = round2(stdHours ? stdHours.total : 0);
    const totalHours = round2(stats ? stats.total_hours : 0);
    const quantityCompleted = Number(stats ? stats.total_qty : 0) || 0;
    const quantityTotal = Number(stats ? stats.qty_total : 0) || 0;
    const hoursRatio = standardManHours > 0 ? clampPercent((totalHours / standardManHours) * 100) : 0;
    const quantityPct = quantityTotal > 0 ? clampPercent((quantityCompleted / quantityTotal) * 100) : null;
    const pendingCount = statusAware
      ? Number((get("SELECT COUNT(*) c FROM work_report_details WHERE process_node_id=? AND status='pending'", [nodeId]) || { c: 0 }).c) || 0
      : 0;
    res.json({
      process_node_id: nodeId,
      total_hours_reported: totalHours,
      total_quantity_completed: quantityCompleted,
      quantity_total: quantityTotal || null,
      report_count: Number(stats ? stats.report_count : 0) || 0,
      pending_reports: pendingCount,
      standard_man_hours: standardManHours,
      completion_pct: quantityPct === null ? hoursRatio : quantityPct,
      hours_ratio_pct: hoursRatio,
      recent_reports: reports,
    });
  }));
}

// === 月结锁定 / 工时日历 ===
function registerGovernance(app, db) {
  const { all, run } = makeHelpers(db);

  app.get("/api/work-report-locks", wrap((req, res) => {
    if (!hasTable(db, "work_month_locks")) return res.json({ items: [] });
    const year = req.query.year ? String(req.query.year) : null;
    const rows = year
      ? all("SELECT * FROM work_month_locks WHERE month LIKE ? ORDER BY month DESC", [year + "-%"])
      : all("SELECT * FROM work_month_locks ORDER BY month DESC");
    res.json({ items: rows, locked_months: rows.map((row) => row.month) });
  }));

  app.post("/api/work-report-locks", wrap((req, res) => {
    if (!hasTable(db, "work_month_locks")) throw ApiError.validation("月结表未创建，请执行迁移脚本");
    const month = String((req.body || {}).month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) throw ApiError.validation("month 格式必须是 YYYY-MM");
    const note = (req.body || {}).note || null;
    run("INSERT INTO work_month_locks (month, locked_by, note, locked_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(month) DO UPDATE SET note=excluded.note, locked_by=excluded.locked_by, locked_at=datetime('now')",
      [month, currentUserId(req), note]);
    res.json({ ok: true, month, locked: true });
  }));

  app.delete("/api/work-report-locks/:month", wrap((req, res) => {
    if (!hasTable(db, "work_month_locks")) throw ApiError.validation("月结表未创建，请执行迁移脚本");
    if (!/^\d{4}-\d{2}$/.test(req.params.month)) throw ApiError.validation("month 格式必须是 YYYY-MM");
    const result = run("DELETE FROM work_month_locks WHERE month=?", [req.params.month]);
    if (!result.changes) throw ApiError.notFound("月份未锁定: " + req.params.month);
    res.json({ ok: true, month: req.params.month, locked: false });
  }));

  app.get("/api/work-calendar", wrap((req, res) => {
    if (!hasTable(db, "work_calendar")) return res.json({ items: [] });
    const { from, to } = req.query;
    const rows = from && to
      ? all("SELECT * FROM work_calendar WHERE date >= ? AND date <= ? ORDER BY date", [from, to])
      : all("SELECT * FROM work_calendar ORDER BY date DESC LIMIT 366");
    res.json({ items: rows });
  }));

  app.post("/api/work-calendar", wrap((req, res) => {
    if (!hasTable(db, "work_calendar")) throw ApiError.validation("工时日历表未创建，请执行迁移脚本");
    const body = req.body || {};
    const date = String(body.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.validation("date 格式必须是 YYYY-MM-DD");
    const dayType = body.day_type || "workday";
    if (!DAY_TYPES.includes(dayType)) throw ApiError.validation("day_type 必须是: " + DAY_TYPES.join("/"));
    const dailyHours = body.daily_hours == null ? (dayType === "workday" ? 8 : 0) : finiteNumber(body.daily_hours);
    if (dailyHours === null || dailyHours < 0 || dailyHours > 24) throw ApiError.validation("daily_hours 必须在 0-24");
    run("INSERT INTO work_calendar (date, day_type, daily_hours, note, updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(date) DO UPDATE SET day_type=excluded.day_type, daily_hours=excluded.daily_hours, note=excluded.note, updated_at=datetime('now')",
      [date, dayType, dailyHours, body.note || null]);
    res.json({ ok: true, date, day_type: dayType, daily_hours: dailyHours });
  }));

  app.delete("/api/work-calendar/:date", wrap((req, res) => {
    if (!hasTable(db, "work_calendar")) throw ApiError.validation("工时日历表未创建");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw ApiError.validation("date 格式必须是 YYYY-MM-DD");
    run("DELETE FROM work_calendar WHERE date=?", [req.params.date]);
    res.json({ ok: true, date: req.params.date });
  }));
}

function register(app, db, auth) {
  runMigration(db);
  registerStandardHours(app, db);
  registerWorkReport(app, db, auth);
  registerGovernance(app, db);
  registerWorkerPerformance(app, db);
  logger.info("[processHoursService] Standard hours + work report(approval/lock/cost) + governance + performance registered");
}

module.exports = {
  register,
  WORK_TYPES,
  QUALITY_RESULTS,
  REPORT_STATUSES,
  MAX_SINGLE_REPORT_HOURS,
  recomputeActualHours,
  syncLaborCost,
  getLaborRate,
  ensureMonthUnlocked,
};
