// services/purchase/trackingSync.js
"use strict";

const {
  SHORTAGE_TERMINAL_STATUSES,
  normalizePurchaseFollowupStatus,
  mapShortageToFollowupStatus,
  isPurchaseFollowupTerminal,
} = require("../../app/domain/statusCatalog");
const { tableExists } = require("./trackingStore");

function ensureTrackingForPo(db, get, all, run, poId) {
  const po = get(`SELECT po.*, s.supplier_name
                  FROM purchase_orders po
                  LEFT JOIN suppliers s ON s.id = po.supplier_id
                  WHERE po.id = ?`, [poId]);
  if (!po) return null;
  const lines = all(`SELECT pl.*, m.material_code, m.material_name
                     FROM po_lines pl
                     LEFT JOIN materials m ON m.id = pl.material_id
                     WHERE pl.po_id = ?
                     ORDER BY pl.line_no`, [poId]);
  const materialIds = lines.map((line) => Number(line.material_id)).filter(Boolean);
  const shortages = tableExists(db, "shortage_cases") && materialIds.length
    ? all(`SELECT sc.id, sc.work_order_id, sc.material_id
           FROM shortage_cases sc
           WHERE COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
             AND sc.material_id IN (${materialIds.map(() => "?").join(",")})
             ${po.equipment_instance_id ? "AND sc.equipment_instance_id = ?" : ""}`,
      po.equipment_instance_id ? [...materialIds, po.equipment_instance_id] : materialIds)
    : [];
  const workOrderCount = new Set(shortages.map((row) => row.work_order_id).filter(Boolean)).size;
  const itemName = lines.length
    ? lines.slice(0, 3).map((line) => `${line.material_code || ""} ${line.material_name || ""}`.trim()).filter(Boolean).join(" / ")
    : po.po_no;
  const plannedDelivery = po.expected_date || lines.map((line) => line.expected_date).find(Boolean) || null;
  const actualDelivery = po.status === "received" ? (po.received_date || null) : null;
  const trackingStatus = po.status === "received"
    ? "delivered"
    : po.status === "cancelled"
      ? "cancelled"
      : ["confirmed", "submitted", "in_transit", "partially_received"].includes(po.status)
        ? "following"
        : "pending";
  const delayDays = plannedDelivery && trackingStatus !== "delivered" && trackingStatus !== "cancelled"
    ? Math.max(0, Math.floor((Date.now() - new Date(plannedDelivery).getTime()) / 86400000))
    : 0;
  const urgentTags = [
    ...(delayDays > 0 ? ["延期"] : []),
    ...(shortages.length ? ["影响齐套"] : []),
    ...(workOrderCount ? ["影响工单"] : []),
  ];
  const tracking = get("SELECT id, owner_id, owner_name, remarks FROM purchase_tracking WHERE purchase_order_id = ?", [poId]);
  const params = [
    "purchase_order",
    poId,
    itemName,
    po.supplier_name || "",
    po.ordered_date || po.created_at || null,
    plannedDelivery,
    actualDelivery,
    delayDays,
    trackingStatus,
    urgentTags.join(" / ") || null,
    tracking?.remarks || po.notes || null,
    po.equipment_instance_id || null,
    null,
    null,
    shortages.length,
    workOrderCount,
    JSON.stringify(shortages.map((row) => Number(row.id)).filter(Boolean)),
    JSON.stringify([...new Set(shortages.map((row) => Number(row.work_order_id)).filter(Boolean))]),
    delayDays > 7 ? "critical" : delayDays > 0 ? "high" : shortages.length ? "warning" : "normal",
    poId,
  ];
  if (tracking) {
    run(`UPDATE purchase_tracking SET
      source_type = ?, source_ref_id = ?, item_name = ?, supplier = ?, order_date = ?, planned_delivery = ?, actual_delivery = ?, delay_days = ?,
      status = ?, urgent_tags = ?, remarks = ?, equipment_instance_id = ?, material_id = ?, purchase_request_no = ?,
      linked_shortage_count = ?, linked_work_order_count = ?, linked_shortage_ids = ?, linked_work_order_ids = ?, risk_level = ?, updated_at = datetime('now')
      WHERE purchase_order_id = ?`, params);
    return tracking.id;
  }
  const created = run(`INSERT INTO purchase_tracking
    (source_type, source_ref_id, item_name, supplier, order_date, planned_delivery, actual_delivery, delay_days, status, urgent_tags, remarks,
     equipment_instance_id, material_id, purchase_request_no, linked_shortage_count, linked_work_order_count, linked_shortage_ids, linked_work_order_ids, risk_level, purchase_order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
  return created.lastInsertRowid;
}

function mapShortageTrackingStatus(status, purchaseRequestNo) {
  return mapShortageToFollowupStatus(status, purchaseRequestNo);
}

function ensureTrackingForShortage(db, get, all, run, shortageId) {
  const shortage = get(`
    SELECT sc.*, m.material_code, m.material_name, wo.wo_code, ei.instance_code
    FROM shortage_cases sc
    LEFT JOIN materials m ON m.id = sc.material_id
    LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
    LEFT JOIN equipment_instances ei ON ei.id = sc.equipment_instance_id
    WHERE sc.id = ?
  `, [shortageId]);
  if (!shortage || SHORTAGE_TERMINAL_STATUSES.includes(String(shortage.status || ""))) return null;
  const purchaseRequestNo = shortage.purchase_request_no || null;
  const shouldTrack = Boolean(purchaseRequestNo || ["following", "purchasing"].includes(shortage.status || ""));
  if (!shouldTrack) return null;
  const trackingStatus = mapShortageTrackingStatus(shortage.status, purchaseRequestNo);
  const plannedDelivery = shortage.expected_date || null;
  const actualDelivery = shortage.status === "arrived" ? (shortage.updated_at || shortage.created_at || null) : null;
  const delayDays = plannedDelivery && !isPurchaseFollowupTerminal(trackingStatus)
    ? Math.max(0, Math.floor((Date.now() - new Date(plannedDelivery).getTime()) / 86400000))
    : 0;
  const workOrderIds = shortage.work_order_id ? [Number(shortage.work_order_id)] : [];
  const urgentTags = [
    "BOM风险催办",
    ...(delayDays > 0 ? ["延期"] : []),
    ...(Number(shortage.shortage_qty || 0) > 0 ? ["影响齐套"] : []),
    ...(workOrderIds.length ? ["影响工单"] : []),
  ];
  const existing = get("SELECT id FROM purchase_tracking WHERE source_type = 'shortage' AND source_ref_id = ?", [shortageId]);
  const virtualPurchaseOrderId = -Math.abs(Number(shortageId));
  const params = [
    "shortage",
    shortageId,
    `${shortage.material_code || ""} ${shortage.material_name || ""}`.trim() || `物料#${shortage.material_id}`,
    "",
    shortage.created_at || null,
    plannedDelivery,
    actualDelivery,
    delayDays,
    trackingStatus,
    urgentTags.join(" / "),
    shortage.last_note || "BOM 风险一键生成采购催办",
    shortage.equipment_instance_id || null,
    shortage.material_id || null,
    purchaseRequestNo,
    shortage.owner_id || null,
    shortage.owner_name || null,
    1,
    workOrderIds.length,
    JSON.stringify([Number(shortage.id)]),
    JSON.stringify(workOrderIds),
    delayDays > 7 ? "critical" : delayDays > 0 ? "high" : (shortage.priority || "warning"),
  ];
  if (existing) {
    run(`UPDATE purchase_tracking SET
      source_type = ?, source_ref_id = ?, item_name = ?, supplier = ?, order_date = ?, planned_delivery = ?, actual_delivery = ?, delay_days = ?,
      status = ?, urgent_tags = ?, remarks = ?, equipment_instance_id = ?, material_id = ?, purchase_request_no = ?, owner_id = ?, owner_name = ?,
      linked_shortage_count = ?, linked_work_order_count = ?, linked_shortage_ids = ?, linked_work_order_ids = ?, risk_level = ?, updated_at = datetime('now')
      WHERE id = ?`, [...params, existing.id]);
    return existing.id;
  }
  const created = run(`INSERT INTO purchase_tracking
    (purchase_order_id, source_type, source_ref_id, item_name, supplier, order_date, planned_delivery, actual_delivery, delay_days, status, urgent_tags, remarks,
     equipment_instance_id, material_id, purchase_request_no, owner_id, owner_name, linked_shortage_count, linked_work_order_count, linked_shortage_ids, linked_work_order_ids, risk_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [virtualPurchaseOrderId, ...params]);
  return created.lastInsertRowid;
}

function syncShortageFollowUps(db, get, all, run) {
  if (!tableExists(db, "shortage_cases")) return;
  const rows = all(`
    SELECT id
    FROM shortage_cases
    WHERE COALESCE(status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
      AND (purchase_request_no IS NOT NULL OR COALESCE(status, '') IN ('following', 'purchasing'))
    ORDER BY updated_at DESC, id DESC
  `);
  for (const row of rows) ensureTrackingForShortage(db, get, all, run, row.id);
}

function normalizeFollowupStatus(status) {
  return normalizePurchaseFollowupStatus(status);
}

function followUpSummary(rows) {
  return {
    total: rows.length,
    overdue: rows.filter((row) => Number(row.delay_days || 0) > 0 && !isPurchaseFollowupTerminal(row.tracking_status)).length,
    impacted_shortages: rows.reduce((sum, row) => sum + Number(row.linked_shortage_count || 0), 0),
    impacted_work_orders: rows.reduce((sum, row) => sum + Number(row.linked_work_order_count || 0), 0),
    pending: rows.filter((row) => ["pending", "following"].includes(row.tracking_status)).length,
  };
}

module.exports = {
  ensureTrackingForPo,
  ensureTrackingForShortage,
  syncShortageFollowUps,
  normalizeFollowupStatus,
  followUpSummary,
};
