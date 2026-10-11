// services/fieldService.js
// MESA #9: 设备维护 - 维护计划/日志/备件/故障报修/点检/仪表板
"use strict";
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");
const { ensureFieldServiceSchema } = require("./fieldServiceSchema");
const fieldServiceCore = require("./fieldServiceCore");

const logger = require("../app/logger").createLogger("fieldService");

function register(app, db) {
  const all = (sql, params) => db.prepare(sql).all(params || []);
  const get = (sql, params) => db.prepare(sql).get(params || []);
  const run = (sql, params) => db.prepare(sql).run(params || []);

  ensureFieldServiceSchema(db);

  // ========== MAINTENANCE PLANS ==========
  app.get("/api/field-service/maintenance-plans", wrap(function(req, res) {
    res.json(fieldServiceCore.listMaintenancePlans(db, req.query));
  }));

  app.post("/api/field-service/maintenance-plans", wrap(function(req, res) {
    res.json(fieldServiceCore.createMaintenancePlan(db, req.body));
  }));

  app.put("/api/field-service/maintenance-plans/:id", wrap(function(req, res) {
    if (!fieldServiceCore.getMaintenancePlan(db, req.params.id)) throw ApiError.notFound("Maintenance plan not found");
    res.json(fieldServiceCore.updateMaintenancePlan(db, req.params.id, req.body));
  }));

  // ========== MAINTENANCE LOGS ==========
  app.post("/api/field-service/maintenance-logs", wrap(function(req, res) {
    var body = req.body;
    if (!body.equipment_instance_id) throw ApiError.validation("equipment_instance_id required");
    var r = run("INSERT INTO maintenance_logs (plan_id, equipment_instance_id, performed_by, hours_spent, findings, actions_taken, parts_replaced, next_due_date, status) VALUES (?,?,?,?,?,?,?,?,?)",
      [body.plan_id || null, body.equipment_instance_id, body.performed_by || null, body.hours_spent || 0, body.findings || null, body.actions_taken || null, body.parts_replaced || null, body.next_due_date || null, body.status || "completed"]);
    res.json({ id: r.lastInsertRowid });
  }));

  app.get("/api/field-service/maintenance-logs", wrap(function(req, res) {
    var sql = "SELECT ml.*, ei.instance_code FROM maintenance_logs ml LEFT JOIN equipment_instances ei ON ml.equipment_instance_id = ei.id WHERE 1=1";
    var params = [];
    if (req.query.plan_id) { sql += " AND ml.plan_id = ?"; params.push(req.query.plan_id); }
    if (req.query.equipment_instance_id) { sql += " AND ml.equipment_instance_id = ?"; params.push(req.query.equipment_instance_id); }
    sql += " ORDER BY ml.performed_at DESC LIMIT 200";
    res.json(all(sql, params));
  }));

  // ========== SPARE PARTS ==========
  app.get("/api/field-service/spare-parts", wrap(function(req, res) {
    res.json(fieldServiceCore.listSpareParts(db, req.query));
  }));

  app.post("/api/field-service/spare-parts", wrap(function(req, res) {
    res.json(fieldServiceCore.createSparePart(db, req.body));
  }));

  app.post("/api/field-service/spare-parts/adjust", wrap(function(req, res) {
    res.json(fieldServiceCore.adjustSparePartStock(db, req.body));
  }));

  app.put("/api/field-service/spare-parts/:id/stock", wrap(function(req, res) {
    if (!fieldServiceCore.getSparePart(db, req.params.id)) throw ApiError.notFound("Spare part not found");
    res.json(fieldServiceCore.setSparePartStock(db, req.params.id, req.body.quantity));
  }));

  // ========== BREAKDOWN REPORTS ==========
  app.get("/api/field-service/breakdowns", wrap(function(req, res) {
    var sql = "SELECT b.*, ei.instance_code, u1.full_name AS reporter_name, u2.full_name AS assignee_name FROM breakdown_reports b LEFT JOIN equipment_instances ei ON b.equipment_instance_id = ei.id LEFT JOIN users u1 ON b.reported_by = u1.id LEFT JOIN users u2 ON b.assigned_to = u2.id WHERE 1=1";
    var params = [];
    if (req.query.equipment_instance_id) { sql += " AND b.equipment_instance_id = ?"; params.push(req.query.equipment_instance_id); }
    if (req.query.status) { sql += " AND b.status = ?"; params.push(req.query.status); }
    if (req.query.severity) { sql += " AND b.severity = ?"; params.push(req.query.severity); }
    sql += " ORDER BY b.reported_at DESC LIMIT 200";
    res.json(all(sql, params));
  }));

  app.post("/api/field-service/breakdowns", wrap(function(req, res) {
    var body = req.body;
    if (!body.equipment_instance_id || !body.fault_type || !body.fault_desc) throw ApiError.validation("equipment_instance_id, fault_type, fault_desc required");
    var today = new Date().toISOString().slice(0,10).replace(/-/g,"");
    var prefix = "BR-" + today + "-";
    var last = get("SELECT report_code FROM breakdown_reports WHERE report_code LIKE ? ORDER BY id DESC LIMIT 1", [prefix + "%"]);
    var seq = 1;
    if (last) { var s = parseInt(last.report_code.split("-").pop()); if (!isNaN(s)) seq = s + 1; }
    var report_code = prefix + String(seq).padStart(3,"0");
    var r = run("INSERT INTO breakdown_reports (equipment_instance_id, report_code, fault_type, fault_desc, severity, reported_by) VALUES (?,?,?,?,?,?)",
      [body.equipment_instance_id, report_code, body.fault_type, body.fault_desc, body.severity || "medium", body.reported_by || null]);
    res.json({ id: r.lastInsertRowid, report_code: report_code });
  }));

  app.put("/api/field-service/breakdowns/:id", wrap(function(req, res) {
    var existing = get("SELECT id FROM breakdown_reports WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("Breakdown not found");
    var allowed = ["status","assigned_to","repair_start","repair_end","downtime_hours","root_cause","repair_actions","parts_used","repair_cost","verified_by"];
    var sets = [], params = [];
    for (var i = 0; i < allowed.length; i++) {
      if (req.body[allowed[i]] !== undefined) { sets.push(allowed[i] + " = ?"); params.push(req.body[allowed[i]]); }
    }
    if (sets.length === 0) throw ApiError.validation("No fields to update");
    params.push(req.params.id);
    run("UPDATE breakdown_reports SET " + sets.join(", ") + " WHERE id = ?", params);
    res.json({ ok: true });
  }));

  // ========== CHECKLISTS (点检表) ==========
  app.get("/api/field-service/checklists", wrap(function(req, res) {
    var sql = "SELECT c.*, ei.instance_code FROM maintenance_checklists c LEFT JOIN equipment_instances ei ON c.equipment_instance_id = ei.id WHERE 1=1";
    var params = [];
    if (req.query.equipment_instance_id) { sql += " AND c.equipment_instance_id = ?"; params.push(req.query.equipment_instance_id); }
    sql += " ORDER BY c.id";
    res.json(all(sql, params));
  }));

  app.post("/api/field-service/checklists", wrap(function(req, res) {
    var body = req.body;
    if (!body.checklist_name || !body.check_type) throw ApiError.validation("checklist_name and check_type required");
    var defaultItems = [
      {name:"外观检查",expected:"无损伤、无锈蚀"},
      {name:"运行声音",expected:"无异响"},
      {name:"温升检查",expected:"<60 C"},
      {name:"润滑状态",expected:"油位正常"},
      {name:"紧固件",expected:"无松动"},
    ];
    var items_json = JSON.stringify(body.items || defaultItems);
    var r = run("INSERT INTO maintenance_checklists (equipment_instance_id, checklist_name, check_type, items_json, assigned_to) VALUES (?,?,?,?,?)",
      [body.equipment_instance_id || null, body.checklist_name, body.check_type, items_json, body.assigned_to || null]);
    res.json({ id: r.lastInsertRowid });
  }));

  app.put("/api/field-service/checklists/:id/execute", wrap(function(req, res) {
    var body = req.body;
    var results_json = JSON.stringify(body.results || []);
    var r = run("INSERT INTO maintenance_logs (plan_id, equipment_instance_id, performed_by, hours_spent, findings, actions_taken, status) VALUES (?,?,?,?,?,?,?)",
      [null, body.equipment_instance_id, body.performed_by || null, body.hours_spent || 0.5, "Checklist: " + (body.checklist_name || ""), results_json, body.all_pass ? "completed" : "issues_found"]);
    res.json({ id: r.lastInsertRowid, log_type: "checklist" });
  }));

  // ========== OVERDUE ==========
  app.get("/api/field-service/overdue", wrap(function(req, res) {
    var plans = all("SELECT mp.*, ei.instance_code FROM maintenance_plans mp LEFT JOIN equipment_instances ei ON mp.equipment_instance_id = ei.id WHERE mp.status = 'active' AND mp.next_due_date IS NOT NULL AND mp.next_due_date < datetime('now') ORDER BY mp.next_due_date ASC");
    res.json(plans);
  }));

  // ========== MAINTENANCE DASHBOARD ==========
  app.get("/api/field-service/dashboard", wrap(function(req, res) {
    var totalPlans = (get("SELECT COUNT(*) c FROM maintenance_plans WHERE status != 'cancelled'") || {c:0}).c;
    var overduePlans = (get("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'active' AND next_due_date IS NOT NULL AND next_due_date < datetime('now')") || {c:0}).c;
    var upcomingPlans = (get("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'active' AND next_due_date BETWEEN datetime('now') AND datetime('now','+7 days')") || {c:0}).c;
    var totalBreakdowns = (get("SELECT COUNT(*) c FROM breakdown_reports") || {c:0}).c;
    var openBreakdowns = (get("SELECT COUNT(*) c FROM breakdown_reports WHERE status NOT IN ('resolved','closed')") || {c:0}).c;
    var lowStockParts = (get("SELECT COUNT(*) c FROM spare_parts WHERE quantity < min_stock") || {c:0}).c;
    var logs30d = (get("SELECT COUNT(*) c FROM maintenance_logs WHERE performed_at >= datetime('now','-30 days')") || {c:0}).c;
    var mtbf = (get("SELECT ROUND(AVG(downtime_hours),1) AS mtbf FROM breakdown_reports WHERE downtime_hours IS NOT NULL AND reported_at >= datetime('now','-90 days')") || {mtbf:0}).mtbf;
    res.json({
      total_plans: totalPlans, overdue_plans: overduePlans, upcoming_7d: upcomingPlans,
      total_breakdowns: totalBreakdowns, open_breakdowns: openBreakdowns,
      low_stock_parts: lowStockParts, logs_30d: logs30d, mtbf_hours: mtbf,
    });
  }));

  logger.info("[fieldService] Maintenance management registered (plans + logs + spares + breakdowns + checklists + dashboard)");
}

module.exports = { register };
