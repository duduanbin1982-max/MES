"use strict";
// services/supplierCollaboration/inspection.js
// 来料检验: 定位收货记录、生成 NCR、回写收货/批次/库存质量状态。
// (原 services/supplierCollaborationService.js 第 104-153 行)

const { ApiError } = require("../../app/errors");
const { get, run, nextNo } = require("./_helpers");

function createNcr(db, inspection, userId) {
  const ncrCode = nextNo(db, "ncr_reports", "ncr_code", "NCR");
  const material = inspection.material_id
    ? get(db, "SELECT material_code, material_name FROM materials WHERE id = ?", [inspection.material_id])
    : null;
  const partName = material ? `${material.material_code} ${material.material_name}` : (inspection.lot_no || "来料物料");
  const purchaseOrder = inspection.purchase_order_id
    ? get(db, "SELECT equipment_instance_id FROM purchase_orders WHERE id = ?", [inspection.purchase_order_id])
    : null;
  const result = run(db, `
    INSERT INTO ncr_reports (ncr_code, source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by)
    VALUES (?, 'incoming', ?, ?, ?, ?, ?, 'major', ?)
  `, [ncrCode, inspection.id, purchaseOrder?.equipment_instance_id || null, partName, inspection.defect_desc || "来料检验不合格", inspection.defect_qty || 1, userId || null]);
  return { id: result.lastInsertRowid, ncr_code: ncrCode };
}

function findReceiving(db, body) {
  if (body.receiving_id) return get(db, "SELECT * FROM purchase_receiving WHERE id = ?", [body.receiving_id]);
  if (body.purchase_order_id && body.lot_no) {
    return get(db, "SELECT * FROM purchase_receiving WHERE po_id = ? AND lot_no = ? ORDER BY id DESC LIMIT 1", [body.purchase_order_id, body.lot_no]);
  }
  return null;
}

function getReceivingContext(db, receivingId) {
  return get(db, `
    SELECT pr.*, po.po_no, po.supplier_id, po.equipment_instance_id,
           pl.material_id, pl.line_no, m.material_code, m.material_name,
           s.supplier_code, s.supplier_name
      FROM purchase_receiving pr
      JOIN purchase_orders po ON po.id = pr.po_id
      JOIN po_lines pl ON pl.id = pr.po_item_id AND pl.po_id = po.id
      JOIN materials m ON m.id = pl.material_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE pr.id = ?
  `, [receivingId]);
}

function applyIncomingInspectionResult(db, receiving, inspectionId, result, inspectorId) {
  if (!receiving) return null;
  if (!["pass", "fail"].includes(result)) throw ApiError.validation("result 必须是 pass/fail");
  const qualityStatus = result === "pass" ? "passed" : "failed";
  const inventoryStatus = result === "pass" ? "available" : "quarantined";
  run(db, `UPDATE purchase_receiving
    SET quality_status=?, inspected_by=?, inspection_id=?
    WHERE id=?`, [result, inspectorId || null, inspectionId, receiving.id]);
  if (receiving.material_lot_id) run(db, "UPDATE material_lots SET quality_status=? WHERE id=?", [qualityStatus, receiving.material_lot_id]);
  if (receiving.inventory_id) run(db, "UPDATE inventory SET status=?, last_updated=datetime('now') WHERE id=?", [inventoryStatus, receiving.inventory_id]);
  return { receiving_id: receiving.id, quality_status: qualityStatus, inventory_status: inventoryStatus };
}

module.exports = { createNcr, findReceiving, getReceivingContext, applyIncomingInspectionResult };
