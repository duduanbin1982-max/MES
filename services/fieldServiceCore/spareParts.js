"use strict";
// 快模式按主题拆分（原 services/fieldServiceCore.js）
const { ApiError } = require("../../app/errors");
const { helpers } = require("./_helpers");

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

module.exports = { adjustSparePartStock, createSparePart, deleteSparePart, getSparePart, listSparePartAlerts, listSpareParts, setSparePartStock, updateSparePart };
