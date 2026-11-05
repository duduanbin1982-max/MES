// services/maintenanceDashboardService.js
// 统一设备维护看板 —— 聚合维保计划、故障报修、备件库存、点检记录、现场服务
"use strict";

const { ApiError } = require("../app/errors");
const { todaySqlDate } = require("../shared/datetime");
const { makeDbHelpers } = require("../app/dbHelpers");
const { wrap } = require("../middleware/asyncHandler");

const logger = require("../app/logger").createLogger("maintenanceDashboard");

function register(app, db) {
  const { get, all, run } = makeDbHelpers(db);

  app.get("/api/maintenance/dashboard", wrap((req, res) => {
    const instanceId = req.query.instance_id ? Number(req.query.instance_id) : null;
    const instFilter = instanceId ? "WHERE equipment_instance_id = ?" : "WHERE 1=1";
    const params = instanceId ? [instanceId] : [];

    // 维保计划概览
    const plans = all(`SELECT * FROM maintenance_plans ${instFilter} ORDER BY next_due_date ASC`, params);
    const today = todaySqlDate();
    const overduePlans = plans.filter(p => p.next_due_date && p.next_due_date < today && !["completed", "cancelled"].includes(p.status));
    const dueSoonPlans = plans.filter(p => {
      if (!p.next_due_date || p.status === "completed") return false;
      const due = new Date(p.next_due_date);
      const soon = new Date(Date.now() + 7*86400000);
      return due >= new Date() && due <= soon;
    });

    // 故障报修
    const breakdowns = all(`SELECT * FROM breakdown_reports ${instFilter} ORDER BY reported_at DESC`, params);
    const openBreakdowns = breakdowns.filter(b => b.status === "open" || b.status === "in_progress");

    // 备件库存
    const spareParts = all(`SELECT * FROM spare_parts ${instFilter} ORDER BY part_code`, params);
    const lowStock = spareParts.filter(s => s.quantity <= s.min_stock);

    // 维保日志近期
    const logs = all(`
      SELECT ml.*, ei.instance_name
      FROM maintenance_logs ml
      LEFT JOIN equipment_instances ei ON ei.id = ml.equipment_instance_id
      ${instFilter.replace("equipment_instance_id", "ml.equipment_instance_id")}
      ORDER BY ml.performed_at DESC
      LIMIT 20
    `, params);

    // 点检
    const checklists = all(`SELECT * FROM maintenance_checklists ${instFilter}`, params);

    // 现场服务
    const fieldServices = all(`SELECT * FROM field_service ${instFilter} ORDER BY reported_date DESC LIMIT 10`, params);

    // 设备实例列表
    const instances = all("SELECT id, instance_code, instance_name, status FROM equipment_instances");

    res.json({
      overview: {
        total_plans: plans.length,
        overdue_plans: overduePlans.length,
        due_soon_plans: dueSoonPlans.length,
        open_breakdowns: openBreakdowns.length,
        total_breakdowns: breakdowns.length,
        low_stock_parts: lowStock.length,
        total_spare_parts: spareParts.length,
        total_logs: logs.length,
        total_checklists: checklists.length,
        active_field_services: fieldServices.filter(f => f.status !== "closed" && f.status !== "resolved").length,
      },
      plans,
      breakdowns,
      spare_parts: spareParts,
      low_stock: lowStock,
      logs,
      checklists,
      field_services: fieldServices,
      instances,
    });
  }));

  // 2026-11-05 rework: plan stays active (next_due by frequency); supports spare consumption
  app.post("/api/maintenance/plans/:id/complete", wrap((req, res) => {
    const plan = get("SELECT * FROM maintenance_plans WHERE id = ?", [req.params.id]);
    if (!plan) throw ApiError.notFound("维保计划不存在");
    const body = req.body || {};
    const spares = Array.isArray(body.spares) ? body.spares : [];
    const frequencyDays = Math.max(1, Number(plan.frequency_days) || 30);
    const tx = db.transaction(() => {
      const logResult = run(`INSERT INTO maintenance_logs (plan_id, equipment_instance_id, performed_by, hours_spent, findings, actions_taken, parts_replaced, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`, [
        plan.id, plan.equipment_instance_id, body.performed_by || 1, body.hours_spent || 1,
        body.findings || null, body.actions_taken || "维保完成",
        spares.length ? spares.map((row) => "#" + row.spare_part_id + "x" + row.quantity).join(", ") : null,
      ]);
      const consumed = [];
      for (const row of spares) {
        const spare = get("SELECT * FROM spare_parts WHERE id = ?", [row.spare_part_id]);
        if (!spare) throw ApiError.notFound("备件不存在: " + row.spare_part_id);
        const quantity = Number(row.quantity);
        if (!(quantity > 0)) throw ApiError.validation("备件数量必须 > 0: " + row.spare_part_id);
        if (Number(spare.quantity) < quantity) {
          throw ApiError.validation("备件库存不足: " + spare.part_name + " 现有 " + spare.quantity + ", 需要 " + quantity);
        }
        run("INSERT INTO maintenance_spare_parts (plan_id, spare_part_id, quantity) VALUES (?, ?, ?)", [plan.id, spare.id, quantity]);
        run("UPDATE spare_parts SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?", [quantity, spare.id]);
        consumed.push({ spare_part_id: spare.id, part_name: spare.part_name, quantity });
      }
      run("UPDATE maintenance_plans SET status = 'active', last_done_date = date('now'), next_due_date = date('now', '+' || ? || ' days'), updated_at = datetime('now') WHERE id = ?", [frequencyDays, plan.id]);
      return { log_id: logResult.lastInsertRowid, consumed };
    });
    const result = tx();
    res.json({ ok: true, completed: true, plan_status: "active", next_due_days: frequencyDays, log_id: result.log_id, spares_consumed: result.consumed });
  }));

  logger.info("[maintenanceDashboard] Registered");
}

module.exports = { register };
