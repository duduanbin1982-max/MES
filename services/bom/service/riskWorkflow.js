"use strict";

const { ApiError } = require("../../../app/errors");
const { cleanText, normalizeFloat, normalizeInt } = require("../core");
const { hasColumns, tableColumns } = require("./schema");

function userDisplayName(user) {
  if (!user) return null;
  return user.full_name || user.username || (user.id ? String(user.id) : null);
}

function nextPurchaseRequestNo(db) {
  const prefix = "PR-" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const row = db.prepare("SELECT purchase_request_no FROM shortage_cases WHERE purchase_request_no LIKE ? ORDER BY purchase_request_no DESC LIMIT 1").get(prefix + "%");
  const seq = row?.purchase_request_no ? Number(String(row.purchase_request_no).split("-").pop() || 0) + 1 : 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

function ensureShortageRows(db, instanceId, body) {
  const materialId = normalizeInt(body.material_id, null);
  if (!materialId) throw ApiError.validation("material_id 必填");
  const rows = db.prepare("SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND material_id = ? ORDER BY id DESC").all(instanceId, materialId);
  if (rows.length) return rows;
  const cols = tableColumns(db, "shortage_cases");
  const insertCols = ["equipment_instance_id", "material_id", "shortage_qty", "required_qty", "available_qty"];
  const insertVals = [instanceId, materialId, normalizeFloat(body.shortage_qty, 0), normalizeFloat(body.required_qty, 0), normalizeFloat(body.available_qty, 0)];
  if (cols.has("unit")) { insertCols.push("unit"); insertVals.push(cleanText(body.unit) || "件"); }
  if (cols.has("status")) { insertCols.push("status"); insertVals.push("open"); }
  if (cols.has("priority")) { insertCols.push("priority"); insertVals.push(cleanText(body.priority) || "high"); }
  if (cols.has("last_note")) { insertCols.push("last_note"); insertVals.push(cleanText(body.note) || "BOM 风险处理自动生成缺料单"); }
  const sql = `INSERT INTO shortage_cases (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`;
  const result = db.prepare(sql).run(...insertVals);
  return [db.prepare("SELECT * FROM shortage_cases WHERE id = ?").get(result.lastInsertRowid)];
}

function getActiveUsers(db) {
  const cols = tableColumns(db, "users");
  if (!cols.size || !cols.has("id")) return [];
  const where = cols.has("is_active") ? "WHERE COALESCE(u.is_active, 1) = 1" : "";
  const roleJoin = cols.has("role_id") ? "LEFT JOIN roles r ON r.id = u.role_id" : "";
  const roleFields = cols.has("role_id")
    ? ", r.role_code, r.role_name"
    : ", NULL AS role_code, NULL AS role_name";
  return db.prepare(`
    SELECT u.id, u.username, u.full_name${roleFields}
    FROM users u
    ${roleJoin}
    ${where}
    ORDER BY COALESCE(u.full_name, u.username, CAST(u.id AS TEXT))
  `).all().map((row) => ({
    id: Number(row.id),
    username: row.username || null,
    full_name: row.full_name || row.username || String(row.id),
    role_code: row.role_code || null,
    role_name: row.role_name || null,
  }));
}

function updateRiskOwner(db, instanceId, body) {
  if (!hasColumns(db, "shortage_cases", ["id", "equipment_instance_id", "material_id"])) {
    throw ApiError.validation("shortage_cases 表不存在或字段不完整");
  }
  const materialId = normalizeInt(body.material_id, null);
  const ownerId = normalizeInt(body.owner_id, null);
  if (!materialId) throw ApiError.validation("material_id 必填");
  if (!ownerId) throw ApiError.validation("owner_id 必填");
  const userCols = tableColumns(db, "users");
  if (!userCols.has("id")) throw ApiError.validation("users 表不存在");
  const user = db.prepare("SELECT id, username, full_name FROM users WHERE id = ?").get(ownerId);
  if (!user) throw ApiError.notFound("责任人不存在");
  const ownerName = userDisplayName(user);
  const ids = Array.isArray(body.shortage_case_ids) ? body.shortage_case_ids.map((id) => Number(id)).filter(Boolean) : [];
  let rows = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    rows = db.prepare(`SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND material_id = ? AND id IN (${placeholders})`).all(instanceId, materialId, ...ids);
  } else {
    rows = db.prepare("SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND material_id = ? ORDER BY id DESC").all(instanceId, materialId);
  }
  if (!rows.length) rows = ensureShortageRows(db, instanceId, body);
  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      UPDATE shortage_cases
      SET owner_id = ?, owner_name = ?, status = CASE WHEN status = 'closed' THEN status ELSE 'assigned' END, updated_at = datetime('now')
      WHERE id = ?
    `);
    rows.forEach((row) => stmt.run(ownerId, ownerName, row.id));
  });
  tx();
  return {
    owner_id: ownerId,
    owner_name: ownerName,
    shortage_case_ids: rows.map((row) => Number(row.id)),
  };
}

function updateRiskEta(db, instanceId, body) {
  const materialId = normalizeInt(body.material_id, null);
  const expectedDate = cleanText(body.expected_date);
  if (!materialId) throw ApiError.validation("material_id 必填");
  if (!expectedDate) throw ApiError.validation("expected_date 必填");
  let shortageRows = hasColumns(db, "shortage_cases", ["id", "equipment_instance_id", "material_id"])
    ? db.prepare("SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND material_id = ? ORDER BY id DESC").all(instanceId, materialId)
    : [];
  if (!shortageRows.length && hasColumns(db, "shortage_cases", ["equipment_instance_id", "material_id", "shortage_qty"])) {
    shortageRows = ensureShortageRows(db, instanceId, body);
  }
  const poIds = Array.isArray(body.purchase_order_ids) ? body.purchase_order_ids.map((id) => Number(id)).filter(Boolean) : [];
  const purchaseRows = hasColumns(db, "purchase_orders", ["id", "equipment_instance_id"])
    ? (poIds.length
      ? db.prepare(`SELECT * FROM purchase_orders WHERE equipment_instance_id = ? AND id IN (${poIds.map(() => "?").join(",")})`).all(instanceId, ...poIds)
      : db.prepare(`
          SELECT DISTINCT po.*
          FROM purchase_orders po
          JOIN purchase_order_items poi ON poi.po_id = po.id
          WHERE po.equipment_instance_id = ? AND poi.material_id = ?
        `).all(instanceId, materialId))
    : [];
  const tx = db.transaction(() => {
    if (shortageRows.length && hasColumns(db, "shortage_cases", ["expected_date"])) {
      const stmt = db.prepare("UPDATE shortage_cases SET expected_date = ?, updated_at = datetime('now') WHERE id = ?");
      shortageRows.forEach((row) => stmt.run(expectedDate, row.id));
    }
    if (purchaseRows.length && hasColumns(db, "purchase_orders", ["expected_date"])) {
      const stmt = db.prepare("UPDATE purchase_orders SET expected_date = ?, updated_at = datetime('now') WHERE id = ?");
      purchaseRows.forEach((row) => stmt.run(expectedDate, row.id));
    }
  });
  tx();
  return {
    expected_date: expectedDate,
    shortage_case_ids: shortageRows.map((row) => Number(row.id)),
    purchase_order_ids: purchaseRows.map((row) => Number(row.id)),
  };
}

function createPurchaseFollowup(db, instanceId, body, actorId = null) {
  if (!hasColumns(db, "shortage_cases", ["equipment_instance_id", "material_id", "shortage_qty"])) {
    throw ApiError.validation("shortage_cases 表不存在或字段不完整");
  }
  const materialId = normalizeInt(body.material_id, null);
  if (!materialId) throw ApiError.validation("material_id 必填");
  const note = cleanText(body.note) || "BOM 风险钻取一键生成采购催办";
  const expectedDate = cleanText(body.expected_date);
  const ownerId = normalizeInt(body.owner_id, null);
  const user = ownerId ? db.prepare("SELECT id, username, full_name FROM users WHERE id = ?").get(ownerId) : null;
  const ownerName = userDisplayName(user);
  const existingRows = db.prepare("SELECT * FROM shortage_cases WHERE equipment_instance_id = ? AND material_id = ? ORDER BY id DESC").all(instanceId, materialId);
  const purchaseRequestNo = nextPurchaseRequestNo(db);
  const tx = db.transaction(() => {
    if (existingRows.length) {
      const stmt = db.prepare(`
        UPDATE shortage_cases
        SET status = CASE WHEN status = 'closed' THEN status ELSE 'following' END,
            purchase_request_no = COALESCE(purchase_request_no, ?),
            expected_date = COALESCE(?, expected_date),
            owner_id = COALESCE(?, owner_id),
            owner_name = COALESCE(?, owner_name),
            last_note = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `);
      existingRows.forEach((row) => stmt.run(purchaseRequestNo, expectedDate, ownerId, ownerName, note, row.id));
      return existingRows.map((row) => row.id);
    }

    const insertCols = ["equipment_instance_id", "material_id", "shortage_qty", "required_qty", "available_qty"];
    const insertVals = [instanceId, materialId, normalizeFloat(body.shortage_qty, 0), normalizeFloat(body.required_qty, 0), normalizeFloat(body.available_qty, 0)];
    const optionalCols = tableColumns(db, "shortage_cases");
    if (optionalCols.has("unit")) { insertCols.push("unit"); insertVals.push(cleanText(body.unit) || "件"); }
    if (optionalCols.has("status")) { insertCols.push("status"); insertVals.push("following"); }
    if (optionalCols.has("owner_id")) { insertCols.push("owner_id"); insertVals.push(ownerId); }
    if (optionalCols.has("owner_name")) { insertCols.push("owner_name"); insertVals.push(ownerName); }
    if (optionalCols.has("expected_date")) { insertCols.push("expected_date"); insertVals.push(expectedDate); }
    if (optionalCols.has("purchase_request_no")) { insertCols.push("purchase_request_no"); insertVals.push(purchaseRequestNo); }
    if (optionalCols.has("priority")) { insertCols.push("priority"); insertVals.push(cleanText(body.priority) || "high"); }
    if (optionalCols.has("last_note")) { insertCols.push("last_note"); insertVals.push(note); }
    const sql = `INSERT INTO shortage_cases (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`;
    const result = db.prepare(sql).run(...insertVals);
    return [Number(result.lastInsertRowid)];
  });
  const caseIds = tx();
  return {
    purchase_request_no: purchaseRequestNo,
    shortage_case_ids: caseIds,
    owner_id: ownerId,
    owner_name: ownerName,
    expected_date: expectedDate,
    note,
    actor_id: actorId,
  };
}

module.exports = {
  getActiveUsers,
  updateRiskOwner,
  updateRiskEta,
  createPurchaseFollowup,
};
