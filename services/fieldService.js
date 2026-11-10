// services/fieldService.js
// 2026-11-10 设备与维护：点检/TPM/备件/故障全部归属车间生产设备（equipment）。
// 项目装备维保旧表 maintenance_plans/logs 不再作为本模块数据源。
"use strict";
const { ApiError } = require("../app/errors");
const { wrap } = require("../middleware/asyncHandler");
const { ensureFieldServiceSchema } = require("./fieldServiceSchema");
const logger = require("../app/logger").createLogger("fieldService");

function register(app, db) {
  const all = (sql, params = []) => db.prepare(sql).all(...params);
  const get = (sql, params = []) => db.prepare(sql).get(...params);
  const run = (sql, params = []) => db.prepare(sql).run(...params);
  ensureFieldServiceSchema(db);
  // 旧项目装备备件复制为车间通用备件（仅首次，按 part_code 去重）。
  try {
    const hasOld = get("SELECT name FROM sqlite_master WHERE type='table' AND name='spare_parts'");
    const hasNew = get("SELECT name FROM sqlite_master WHERE type='table' AND name='equipment_spare_parts'");
    if (hasOld && hasNew) {
      db.exec(`INSERT INTO equipment_spare_parts (equipment_id, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes)
        SELECT NULL, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes
          FROM spare_parts
         WHERE NOT EXISTS (SELECT 1 FROM equipment_spare_parts e WHERE e.part_code = spare_parts.part_code)`);
    }
  } catch (_error) { /* 老库无 spare_parts 时忽略 */ }
  const today = () => new Date().toISOString().slice(0, 10);

  const planSql = `
    SELECT p.*, e.code AS equipment_code, e.name AS equipment_name, e.status AS equipment_status,
           w.workshop, u.full_name AS assignee_name
      FROM equipment_maintenance_plans p
      LEFT JOIN equipment e ON e.id = p.equipment_id
      LEFT JOIN workstations w ON w.id = e.workstation_id
      LEFT JOIN users u ON u.id = p.assigned_to
     WHERE 1=1`;

  app.get("/api/field-service/maintenance-plans", wrap((req, res) => {
    const where = [];
    const params = [];
    if (req.query.equipment_id) { where.push("p.equipment_id = ?"); params.push(Number(req.query.equipment_id)); }
    if (req.query.status) { where.push("p.status = ?"); params.push(String(req.query.status)); }
    if (req.query.overdue === "1") { where.push("p.next_due_date < date('now') AND p.status != 'completed'"); }
    const rows = all(`${planSql}${where.length ? " AND " + where.join(" AND ") : ""} ORDER BY COALESCE(p.next_due_date, '9999-12-31'), p.id`, params);
    res.json(rows);
  }));

  app.post("/api/field-service/maintenance-plans", wrap((req, res) => {
    const body = req.body || {};
    if (!body.equipment_id) throw ApiError.validation("equipment_id required");
    if (!get("SELECT id FROM equipment WHERE id = ?", [body.equipment_id])) throw ApiError.validation("设备不存在");
    if (!body.plan_name) throw ApiError.validation("plan_name required");
    const equipment = get("SELECT code FROM equipment WHERE id = ?", [body.equipment_id]);
    const planCode = body.plan_code || `MP-${equipment.code}-${Date.now().toString().slice(-5)}`;
    const result = run(`INSERT INTO equipment_maintenance_plans
      (equipment_id, plan_code, plan_name, maintenance_type, frequency_days, next_due_date, last_done_date, status, assigned_to, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.equipment_id, planCode, body.plan_name, body.maintenance_type || "periodic",
       Number(body.frequency_days || 90), body.next_due_date || null, body.last_done_date || null,
       body.status || "pending", body.assigned_to || null, body.notes || null]);
    res.json({ id: Number(result.lastInsertRowid) });
  }));

  app.put("/api/field-service/maintenance-plans/:id", wrap((req, res) => {
    const existing = get("SELECT * FROM equipment_maintenance_plans WHERE id = ?", [req.params.id]);
    if (!existing) throw ApiError.notFound("Maintenance plan not found");
    const allowed = ["equipment_id", "plan_code", "plan_name", "maintenance_type", "frequency_days", "next_due_date", "last_done_date", "status", "assigned_to", "notes"];
    const sets = []; const values = [];
    for (const field of allowed) if (req.body?.[field] !== undefined) { sets.push(`${field} = ?`); values.push(req.body[field]); }
    if (!sets.length) throw ApiError.validation("no fields");
    values.push(req.params.id);
    run(`UPDATE equipment_maintenance_plans SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, values);
    res.json({ success: true, ok: true });
  }));

  app.post("/api/field-service/maintenance-plans/:id/complete", wrap((req, res) => {
    const plan = get("SELECT * FROM equipment_maintenance_plans WHERE id = ?", [req.params.id]);
    if (!plan) throw ApiError.notFound("Maintenance plan not found");
    const days = Number(plan.frequency_days || 90);
    run("UPDATE equipment_maintenance_plans SET status = 'completed', last_done_date = date('now'), next_due_date = date('now', ?), updated_at = datetime('now') WHERE id = ?", [`+${days} days`, req.params.id]);
    res.json({ success: true, ok: true, next_due_date: get("SELECT next_due_date FROM equipment_maintenance_plans WHERE id = ?", [req.params.id])?.next_due_date });
  }));

  app.post("/api/field-service/maintenance-logs", wrap((req, res) => {
    const body = req.body || {};
    if (!body.equipment_id) throw ApiError.validation("equipment_id required");
    const plan = body.plan_id ? get("SELECT * FROM equipment_maintenance_plans WHERE id = ?", [body.plan_id]) : null;
    const result = run(`INSERT INTO equipment_maintenance_logs
      (equipment_id, plan_id, performed_by, performed_at, hours_spent, findings, actions_taken, parts_replaced, next_due_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.equipment_id, body.plan_id || null, body.performed_by || null, body.performed_at || today(),
       Number(body.hours_spent || 0), body.findings || null, body.actions_taken || null,
       body.parts_replaced || null, body.next_due_at || null, body.status || "completed"]);
    if (plan) {
      run("UPDATE equipment_maintenance_plans SET last_done_date = ?, next_due_date = COALESCE(?, next_due_date), updated_at = datetime('now') WHERE id = ?",
        [body.performed_at || today(), body.next_due_at || null, plan.id]);
    }
    run("UPDATE equipment SET last_maintenance = ?, updated_at = datetime('now') WHERE id = ?", [body.performed_at || today(), body.equipment_id]);
    res.json({ id: Number(result.lastInsertRowid) });
  }));

  app.get("/api/field-service/maintenance-logs", wrap((req, res) => {
    const where = []; const params = [];
    let sql = `SELECT l.*, e.code AS equipment_code, e.name AS equipment_name,
                      p.plan_name, u.full_name AS performer_name
                 FROM equipment_maintenance_logs l
                 LEFT JOIN equipment e ON e.id = l.equipment_id
                 LEFT JOIN equipment_maintenance_plans p ON p.id = l.plan_id
                 LEFT JOIN users u ON u.id = l.performed_by
                WHERE 1=1`;
    if (req.query.plan_id) { where.push("l.plan_id = ?"); params.push(req.query.plan_id); }
    if (req.query.equipment_id) { where.push("l.equipment_id = ?"); params.push(req.query.equipment_id); }
    if (req.query.start_date) { where.push("date(l.performed_at) >= date(?)"); params.push(req.query.start_date); }
    if (req.query.end_date) { where.push("date(l.performed_at) <= date(?)"); params.push(req.query.end_date); }
    if (req.query.status) { where.push("l.status = ?"); params.push(req.query.status); }
    if (where.length) sql += " AND " + where.join(" AND ");
    sql += " ORDER BY l.performed_at DESC, l.id DESC LIMIT 200";
    res.json(all(sql, params));
  }));

  // ===== 点检表 =====
  app.get("/api/field-service/checklists", wrap((req, res) => {
    let sql = `SELECT c.*, e.code AS equipment_code, e.name AS equipment_name
                 FROM equipment_checklists c LEFT JOIN equipment e ON e.id = c.equipment_id WHERE 1=1`;
    const params = [];
    if (req.query.equipment_id) { sql += " AND c.equipment_id = ?"; params.push(req.query.equipment_id); }
    sql += " ORDER BY c.id";
    res.json(all(sql, params));
  }));

  app.post("/api/field-service/checklists", wrap((req, res) => {
    const body = req.body || {};
    if (!body.checklist_name || !body.check_type) throw ApiError.validation("checklist_name and check_type required");
    const defaultItems = [
      { name: "外观检查", expected: "无损伤、无锈蚀" },
      { name: "运行声音", expected: "无异响" },
      { name: "温升检查", expected: "<60 C" },
      { name: "润滑状态", expected: "油位正常" },
      { name: "紧固件", expected: "无松动" },
    ];
    const result = run("INSERT INTO equipment_checklists (equipment_id, checklist_name, check_type, items_json, assigned_to) VALUES (?, ?, ?, ?, ?)",
      [body.equipment_id || null, body.checklist_name, body.check_type, JSON.stringify(body.items || defaultItems), body.assigned_to || null]);
    res.json({ id: Number(result.lastInsertRowid) });
  }));

  app.put("/api/field-service/checklists/:id/execute", wrap((req, res) => {
    const body = req.body || {};
    const checklist = get("SELECT * FROM equipment_checklists WHERE id = ?", [req.params.id]);
    if (!checklist) throw ApiError.notFound("Checklist not found");
    const equipmentId = body.equipment_id || checklist.equipment_id;
    if (!equipmentId) throw ApiError.validation("equipment_id required");
    const result = run(`INSERT INTO equipment_maintenance_logs
      (equipment_id, plan_id, performed_by, performed_at, hours_spent, findings, actions_taken, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      [equipmentId, body.performed_by || null, today(), Number(body.hours_spent || 0.5),
       `Checklist: ${body.checklist_name || checklist.checklist_name}`,
       JSON.stringify(body.results || []), body.all_pass ? "completed" : "issues_found"]);
    run("UPDATE equipment_checklists SET last_executed_at = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ id: Number(result.lastInsertRowid), log_type: "checklist" });
  }));

  // ===== 故障报修 =====
  app.get("/api/field-service/breakdowns", wrap((req, res) => {
    let sql = `SELECT b.*, e.code AS equipment_code, e.name AS equipment_name,
                      u1.full_name AS reporter_name, u2.full_name AS assignee_name
                 FROM equipment_breakdowns b
                 LEFT JOIN equipment e ON e.id = b.equipment_id
                 LEFT JOIN users u1 ON u1.id = b.reported_by
                 LEFT JOIN users u2 ON u2.id = b.assigned_to WHERE 1=1`;
    const params = [];
    if (req.query.equipment_id) { sql += " AND b.equipment_id = ?"; params.push(req.query.equipment_id); }
    if (req.query.status) { sql += " AND b.status = ?"; params.push(req.query.status); }
    if (req.query.severity) { sql += " AND b.severity = ?"; params.push(req.query.severity); }
    sql += " ORDER BY b.reported_at DESC LIMIT 200";
    res.json(all(sql, params));
  }));

  app.post("/api/field-service/breakdowns", wrap((req, res) => {
    const body = req.body || {};
    if (!body.equipment_id || !body.fault_type || !body.fault_desc) throw ApiError.validation("equipment_id, fault_type, fault_desc required");
    if (!get("SELECT id FROM equipment WHERE id = ?", [body.equipment_id])) throw ApiError.validation("设备不存在");
    const todayCode = today().replace(/-/g, "");
    const prefix = `BR-${todayCode}-`;
    const last = get("SELECT report_code FROM equipment_breakdowns WHERE report_code LIKE ? ORDER BY id DESC LIMIT 1", [`${prefix}%`]);
    let seq = 1;
    if (last) { const s = parseInt(last.report_code.split("-").pop()); if (!Number.isNaN(s)) seq = s + 1; }
    const reportCode = prefix + String(seq).padStart(3, "0");
    const result = run(`INSERT INTO equipment_breakdowns
      (equipment_id, report_code, fault_type, fault_desc, severity, reported_by)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [body.equipment_id, reportCode, body.fault_type, body.fault_desc, body.severity || "medium", body.reported_by || null]);
    res.json({ id: Number(result.lastInsertRowid), report_code: reportCode });
  }));

  app.put("/api/field-service/breakdowns/:id", wrap((req, res) => {
    if (!get("SELECT id FROM equipment_breakdowns WHERE id = ?", [req.params.id])) throw ApiError.notFound("Breakdown not found");
    const allowed = ["status", "assigned_to", "repair_start", "repair_end", "downtime_hours", "root_cause", "repair_actions", "parts_used", "repair_cost", "verified_by"];
    const sets = []; const values = [];
    for (const field of allowed) if (req.body?.[field] !== undefined) { sets.push(`${field} = ?`); values.push(req.body[field]); }
    if (!sets.length) throw ApiError.validation("No fields to update");
    values.push(req.params.id);
    run(`UPDATE equipment_breakdowns SET ${sets.join(", ")} WHERE id = ?`, values);
    res.json({ ok: true });
  }));

  // ===== 备件 =====
  app.get("/api/field-service/spare-parts", wrap((req, res) => {
    let sql = `SELECT s.*, s.quantity AS current_stock, e.code AS equipment_code, e.name AS equipment_name
                 FROM equipment_spare_parts s LEFT JOIN equipment e ON e.id = s.equipment_id WHERE 1=1`;
    const params = [];
    if (req.query.equipment_id) { sql += " AND s.equipment_id = ?"; params.push(req.query.equipment_id); }
    if (req.query.low_stock === "1") sql += " AND s.quantity <= s.min_stock";
    sql += " ORDER BY s.quantity ASC, s.part_code";
    res.json(all(sql, params));
  }));

  app.post("/api/field-service/spare-parts", wrap((req, res) => {
    const body = req.body || {};
    if (!body.part_name && !body.part_code) throw ApiError.validation("part_name or part_code required");
    const result = run(`INSERT INTO equipment_spare_parts
      (equipment_id, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.equipment_id || null, body.part_code || null, body.part_name || body.part_code,
       body.part_type || "mechanical", Number(body.quantity || 0), Number(body.min_stock || 5),
       body.unit || "pcs", body.location || null, body.supplier || null, Number(body.unit_price || 0), body.notes || null]);
    res.json({ id: Number(result.lastInsertRowid) });
  }));

  app.post("/api/field-service/spare-parts/adjust", wrap((req, res) => {
    const body = req.body || {};
    if (!body.spare_part_id) throw ApiError.validation("spare_part_id required");
    const quantity = Number(body.quantity || 0);
    if (quantity <= 0) throw ApiError.validation("quantity must be > 0");
    const part = get("SELECT * FROM equipment_spare_parts WHERE id = ?", [body.spare_part_id]);
    if (!part) throw ApiError.notFound("spare part not found");
    const direction = body.type === "out" ? -1 : 1;
    const nextQty = Math.max(0, Number(part.quantity || 0) + direction * quantity);
    run("UPDATE equipment_spare_parts SET quantity = ?, updated_at = datetime('now') WHERE id = ?", [nextQty, body.spare_part_id]);
    res.json({ ok: true, quantity: nextQty });
  }));

  app.put("/api/field-service/spare-parts/:id/stock", wrap((req, res) => {
    if (!get("SELECT id FROM equipment_spare_parts WHERE id = ?", [req.params.id])) throw ApiError.notFound("spare part not found");
    run("UPDATE equipment_spare_parts SET quantity = ?, updated_at = datetime('now') WHERE id = ?", [Number(req.body?.quantity || 0), req.params.id]);
    res.json({ ok: true });
  }));

  // ===== 逾期/仪表板 =====
  app.get("/api/field-service/overdue", wrap((_req, res) => {
    const plans = all(`SELECT p.*, e.code AS equipment_code, e.name AS equipment_name
                         FROM equipment_maintenance_plans p LEFT JOIN equipment e ON e.id = p.equipment_id
                        WHERE p.status IN ('active','pending') AND p.next_due_date IS NOT NULL
                          AND date(p.next_due_date) < date('now','localtime')
                        ORDER BY p.next_due_date ASC`);
    res.json(plans);
  }));

  app.get("/api/field-service/dashboard", wrap((_req, res) => {
    const totalPlans = (get("SELECT COUNT(*) c FROM equipment_maintenance_plans WHERE status != 'cancelled'") || { c: 0 }).c;
    const overduePlans = (get("SELECT COUNT(*) c FROM equipment_maintenance_plans WHERE status IN ('active','pending') AND next_due_date IS NOT NULL AND date(next_due_date) < date('now','localtime')") || { c: 0 }).c;
    const upcomingPlans = (get("SELECT COUNT(*) c FROM equipment_maintenance_plans WHERE status IN ('active','pending') AND next_due_date BETWEEN date('now','localtime') AND date('now','localtime','+7 days')") || { c: 0 }).c;
    const totalBreakdowns = (get("SELECT COUNT(*) c FROM equipment_breakdowns") || { c: 0 }).c;
    const openBreakdowns = (get("SELECT COUNT(*) c FROM equipment_breakdowns WHERE status NOT IN ('resolved','closed')") || { c: 0 }).c;
    const lowStockParts = (get("SELECT COUNT(*) c FROM equipment_spare_parts WHERE quantity < min_stock") || { c: 0 }).c;
    const logs30d = (get("SELECT COUNT(*) c FROM equipment_maintenance_logs WHERE performed_at >= datetime('now','-30 days')") || { c: 0 }).c;
    const repairStats = get(`SELECT COUNT(*) AS failures, COALESCE(SUM(downtime_hours),0) AS downtime
                               FROM equipment_breakdowns
                              WHERE downtime_hours IS NOT NULL AND reported_at >= datetime('now','-90 days')`) || { failures: 0, downtime: 0 };
    const failures = Number(repairStats.failures) || 0;
    const totalDowntime = Number(repairStats.downtime) || 0;
    res.json({
      total_plans: totalPlans, overdue_plans: overduePlans, upcoming_7d: upcomingPlans,
      total_breakdowns: totalBreakdowns, open_breakdowns: openBreakdowns,
      low_stock_parts: lowStockParts, logs_30d: logs30d,
      mtbf_hours: failures > 0 ? Math.round(((90 * 24 - totalDowntime) / failures) * 10) / 10 : null,
      mttr_hours: failures > 0 ? Math.round((totalDowntime / failures) * 10) / 10 : 0,
      breakdown_failures: failures,
    });
  }));

  logger.info("[fieldService] Workshop equipment TPM registered (plans + logs + spares + breakdowns + checklists + dashboard)");
}

module.exports = { register };
