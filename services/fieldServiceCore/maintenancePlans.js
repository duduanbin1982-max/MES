"use strict";
// 快模式按主题拆分（原 services/fieldServiceCore.js）
const { ApiError } = require("../../app/errors");
const { helpers, upsertMaintenancePlanSpares } = require("./_helpers");

function listMaintenancePlans(db, query = {}) {
  const { all } = helpers(db);
  let sql = "SELECT mp.*, ei.instance_code, ei.instance_name, u.full_name AS assignee_name FROM maintenance_plans mp LEFT JOIN equipment_instances ei ON mp.equipment_instance_id = ei.id LEFT JOIN users u ON mp.assigned_to = u.id WHERE 1=1";
  const params = [];
  if (query.equipment_instance_id) {
    sql += " AND mp.equipment_instance_id = ?";
    params.push(query.equipment_instance_id);
  }
  if (query.status) {
    sql += " AND mp.status = ?";
    params.push(query.status);
  }
  if (query.overdue === "1") {
    sql += " AND mp.next_due_date < date('now') AND mp.status != 'completed'";
  }
  sql += " ORDER BY mp.next_due_date ASC";
  return all(sql, params);
}

function getMaintenancePlan(db, id) {
  const { all, get } = helpers(db);
  const plan = get(
    "SELECT mp.*, ei.instance_code, ei.instance_name, u.full_name AS assignee_name FROM maintenance_plans mp LEFT JOIN equipment_instances ei ON mp.equipment_instance_id = ei.id LEFT JOIN users u ON mp.assigned_to = u.id WHERE mp.id = ?",
    [id],
  );
  if (!plan) return null;
  plan.spare_parts = all(
    "SELECT sp.*, msp.quantity AS plan_qty FROM maintenance_spare_parts msp JOIN spare_parts sp ON msp.spare_part_id = sp.id WHERE msp.plan_id = ?",
    [id],
  );
  return plan;
}

function createMaintenancePlan(db, body = {}) {
  if (!body.plan_code && !body.plan_name && !body.maintenance_type) {
    throw ApiError.validation("plan_name or maintenance_type required");
  }
  const { db: rawDb, run } = helpers(db);
  const tx = rawDb.transaction(() => {
    const result = run(
      "INSERT INTO maintenance_plans (equipment_instance_id, plan_code, plan_name, maintenance_type, frequency_days, next_due_date, assigned_to, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        body.equipment_instance_id || null,
        body.plan_code || null,
        body.plan_name || body.maintenance_type || "维保计划",
        body.maintenance_type || "routine",
        Number(body.frequency_days || 90),
        body.next_due_date || null,
        body.assigned_to || null,
        body.notes || null,
      ],
    );
    upsertMaintenancePlanSpares(rawDb, result.lastInsertRowid, body.spare_parts);
    return result;
  });
  const result = tx();
  return { id: result.lastInsertRowid };
}

function updateMaintenancePlan(db, id, body = {}) {
  const { db: rawDb, run } = helpers(db);
  const tx = rawDb.transaction(() => {
    const allowed = ["equipment_instance_id", "plan_code", "plan_name", "maintenance_type", "frequency_days", "next_due_date", "last_done_date", "status", "assigned_to", "notes"];
    const sets = [];
    const values = [];
    for (const field of allowed) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        values.push(body[field]);
      }
    }
    if (sets.length) {
      values.push(id);
      run(`UPDATE maintenance_plans SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, values);
    }
    upsertMaintenancePlanSpares(rawDb, id, body.spare_parts);
  });
  tx();
  return { success: true, ok: true };
}

function deleteMaintenancePlan(db, id) {
  const { run } = helpers(db);
  run("DELETE FROM maintenance_spare_parts WHERE plan_id = ?", [id]);
  run("DELETE FROM maintenance_plans WHERE id = ?", [id]);
  return { success: true, ok: true };
}

function completeMaintenancePlan(db, id) {
  const { get, run } = helpers(db);
  const plan = get("SELECT * FROM maintenance_plans WHERE id = ?", [id]);
  if (!plan) throw ApiError.notFound("maintenance plan not found");
  const days = Number(plan.frequency_days || 90);
  run(
    "UPDATE maintenance_plans SET status = 'completed', last_done_date = date('now'), next_due_date = date('now', ?), updated_at = datetime('now') WHERE id = ?",
    [`+${days} days`, id],
  );
  return { success: true, ok: true, next_due_date: get("SELECT next_due_date FROM maintenance_plans WHERE id = ?", [id])?.next_due_date };
}

module.exports = { completeMaintenancePlan, createMaintenancePlan, deleteMaintenancePlan, getMaintenancePlan, listMaintenancePlans, updateMaintenancePlan };
