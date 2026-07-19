"use strict";

const { ApiError } = require("../app/errors");

function helpers(db) {
  return {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    tx: (fn) => db.transaction(fn),
    db,
  };
}

function listFieldServiceTickets(db) {
  const { all } = helpers(db);
  return all(
    "SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id ORDER BY fs.reported_date DESC",
  );
}

function getFieldServiceTicket(db, id) {
  const { get } = helpers(db);
  return get(
    "SELECT fs.*, ei.instance_code, ei.instance_name FROM field_service fs LEFT JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id WHERE fs.id = ?",
    [id],
  );
}

function createFieldServiceTicket(db, body = {}) {
  const { run } = helpers(db);
  if (!body.equipment_instance_id || !body.title) {
    throw ApiError.validation("equipment_instance_id/title required");
  }
  const result = run(
    "INSERT INTO field_service (equipment_instance_id, service_type, title, description, priority) VALUES (?, ?, ?, ?, ?)",
    [body.equipment_instance_id, body.service_type || null, body.title, body.description || null, body.priority || "normal"],
  );
  return { id: result.lastInsertRowid };
}

function updateFieldServiceTicket(db, id, body = {}) {
  const { run } = helpers(db);
  const allowed = ["status", "resolution_notes", "service_type", "title", "description", "priority", "assigned_to"];
  const sets = [];
  const values = [];
  for (const field of allowed) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (body.status === "resolved") sets.push("resolved_date = datetime('now')");
  if (!sets.length) throw ApiError.validation("no fields");
  values.push(id);
  run(`UPDATE field_service SET ${sets.join(", ")} WHERE id = ?`, values);
  return { success: true, ok: true };
}

function listSpareParts(db, query = {}) {
  const { all } = helpers(db);
  let sql = "SELECT sp.*, ei.instance_code, ei.instance_name FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id = ei.id WHERE 1=1";
  const params = [];
  if (query.equipment_instance_id) {
    sql += " AND sp.equipment_instance_id = ?";
    params.push(query.equipment_instance_id);
  }
  if (query.part_type) {
    sql += " AND sp.part_type = ?";
    params.push(query.part_type);
  }
  if (query.low_stock === "1") {
    sql += " AND sp.quantity <= sp.min_stock";
  }
  sql += " ORDER BY sp.quantity ASC, sp.part_code";
  return all(sql, params);
}

function getSparePart(db, id) {
  const { get } = helpers(db);
  return get(
    "SELECT sp.*, ei.instance_code, ei.instance_name FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id = ei.id WHERE sp.id = ?",
    [id],
  );
}

function createSparePart(db, body = {}) {
  const { run } = helpers(db);
  if (!body.part_name && !body.part_code) throw ApiError.validation("part_name or part_code required");
  const result = run(
    "INSERT INTO spare_parts (equipment_instance_id, part_code, part_name, part_type, quantity, min_stock, unit, location, supplier, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      body.equipment_instance_id || null,
      body.part_code || null,
      body.part_name || body.part_code,
      body.part_type || "mechanical",
      Number(body.quantity || 0),
      Number(body.min_stock || 5),
      body.unit || "pcs",
      body.location || null,
      body.supplier || null,
      Number(body.unit_price || 0),
      body.notes || null,
    ],
  );
  return { id: result.lastInsertRowid };
}

function updateSparePart(db, id, body = {}) {
  const { run } = helpers(db);
  const allowed = ["equipment_instance_id", "part_code", "part_name", "part_type", "quantity", "min_stock", "unit", "location", "supplier", "unit_price", "notes"];
  const sets = [];
  const values = [];
  for (const field of allowed) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (!sets.length) throw ApiError.validation("no fields");
  values.push(id);
  run(`UPDATE spare_parts SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, values);
  return { success: true, ok: true };
}

function setSparePartStock(db, id, quantity) {
  if (quantity === undefined) throw ApiError.validation("quantity required");
  const { run } = helpers(db);
  run("UPDATE spare_parts SET quantity = ?, updated_at = datetime('now') WHERE id = ?", [Number(quantity), id]);
  return { ok: true };
}

function adjustSparePartStock(db, body = {}) {
  if (!body.spare_part_id) throw ApiError.validation("spare_part_id required");
  const quantity = Number(body.quantity || 0);
  if (quantity <= 0) throw ApiError.validation("quantity must be > 0");
  const direction = body.type === "out" ? -1 : 1;
  const { get, run } = helpers(db);
  const part = get("SELECT id, quantity FROM spare_parts WHERE id = ?", [body.spare_part_id]);
  if (!part) throw ApiError.notFound("spare part not found");
  const nextQty = Math.max(0, Number(part.quantity || 0) + direction * quantity);
  run("UPDATE spare_parts SET quantity = ?, notes = COALESCE(notes, '') || ?, updated_at = datetime('now') WHERE id = ?", [
    nextQty,
    body.notes ? `\n[${new Date().toISOString()}] ${body.type || "in"} ${quantity}: ${body.notes}` : "",
    body.spare_part_id,
  ]);
  return { ok: true, quantity: nextQty };
}

function deleteSparePart(db, id) {
  const { run } = helpers(db);
  run("DELETE FROM spare_parts WHERE id = ?", [id]);
  return { success: true, ok: true };
}

function listSparePartAlerts(db) {
  const { all } = helpers(db);
  return all(
    "SELECT sp.*, ei.instance_code FROM spare_parts sp LEFT JOIN equipment_instances ei ON sp.equipment_instance_id = ei.id WHERE sp.quantity <= sp.min_stock ORDER BY (sp.min_stock - sp.quantity) DESC",
  );
}

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

function upsertMaintenancePlanSpares(db, planId, spareParts) {
  if (spareParts === undefined) return;
  db.prepare("DELETE FROM maintenance_spare_parts WHERE plan_id = ?").run(planId);
  if (!Array.isArray(spareParts) || !spareParts.length) return;
  const insert = db.prepare("INSERT OR IGNORE INTO maintenance_spare_parts (plan_id, spare_part_id, quantity) VALUES (?, ?, ?)");
  for (const sparePart of spareParts) {
    insert.run(planId, sparePart.spare_part_id, sparePart.quantity || 1);
  }
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

function maintenancePlanStats(db) {
  const { get } = helpers(db);
  const count = (sql) => get(sql)?.c || 0;
  return {
    total: count("SELECT COUNT(*) c FROM maintenance_plans"),
    pending: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'pending'"),
    in_progress: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'in_progress'"),
    completed: count("SELECT COUNT(*) c FROM maintenance_plans WHERE status = 'completed'"),
    overdue: count("SELECT COUNT(*) c FROM maintenance_plans WHERE next_due_date < date('now') AND status != 'completed'"),
  };
}

module.exports = {
  adjustSparePartStock,
  completeMaintenancePlan,
  createFieldServiceTicket,
  createMaintenancePlan,
  createSparePart,
  deleteMaintenancePlan,
  deleteSparePart,
  getFieldServiceTicket,
  getMaintenancePlan,
  getSparePart,
  listFieldServiceTickets,
  listMaintenancePlans,
  listSparePartAlerts,
  listSpareParts,
  maintenancePlanStats,
  setSparePartStock,
  updateFieldServiceTicket,
  updateMaintenancePlan,
  updateSparePart,
};
