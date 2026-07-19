// services/maintenanceDashboardService.js
// 统一设备维护看板 —— 聚合维保计划、故障报修、备件库存、点检记录、现场服务
"use strict";

const { ApiError } = require("../app/errors");
const { makeDbHelpers } = require("../app/dbHelpers");
const { wrap } = require("../middleware/asyncHandler");

function register(app, db) {
  const { get, all, run } = makeDbHelpers(db);

  app.get("/api/maintenance/dashboard", wrap((req, res) => {
    const instanceId = req.query.instance_id ? Number(req.query.instance_id) : null;
    const instFilter = instanceId ? "WHERE equipment_instance_id = ?" : "WHERE 1=1";
    const params = instanceId ? [instanceId] : [];

    // 维保计划概览
    const plans = all(`SELECT * FROM maintenance_plans ${instFilter} ORDER BY next_due_date ASC`, params);
    const overduePlans = plans.filter(p => p.next_due_date && p.next_due_date < new Date().toISOString().slice(0,10) && p.status !== "completed");
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

  // 快速完成维保
  app.post("/api/maintenance/plans/:id/complete", wrap((req, res) => {
    const plan = get("SELECT * FROM maintenance_plans WHERE id = ?", [req.params.id]);
    if (!plan) throw ApiError.notFound("维保计划不存在");
    const body = req.body || {};
    run(`UPDATE maintenance_plans SET status = 'completed', last_done_date = date('now'), next_due_date = date('now', '+' || frequency_days || ' days'), updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
    run(`INSERT INTO maintenance_logs (plan_id, equipment_instance_id, performed_by, hours_spent, findings, actions_taken, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')`, [
      plan.id, plan.equipment_instance_id, body.performed_by || 1, body.hours_spent || 1, body.findings || null, body.actions_taken || "维保完成"
    ]);
    res.json({ ok: true, completed: true });
  }));

  console.log("[maintenanceDashboard] Registered");
}

module.exports = { register };
