"use strict";
// 快模式按主题拆分（原 services/fieldServiceCore.js）
const { ApiError } = require("../../app/errors");
const { helpers } = require("./_helpers");

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

module.exports = { createFieldServiceTicket, getFieldServiceTicket, listFieldServiceTickets, updateFieldServiceTicket };
