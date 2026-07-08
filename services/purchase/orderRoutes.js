// services/purchase/orderRoutes.js
"use strict";

const { nextPoNo } = require("./_helpers");
const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");
const { PURCHASE_ORDER_STATUSES: PO_STATUSES } = require("../../app/domain/statusCatalog");
const { ensureTrackingForPo } = require("./trackingSync");

function registerPurchaseOrderRoutes(app, db, helpers) {
  const { all, get, run } = helpers;

  app.get("/api/purchase_orders", wrap((req, res) => {
    const { supplier_id, status, equipment_instance_id } = req.query;
    let sql = `SELECT po.*, s.supplier_name, ei.instance_code
               FROM purchase_orders po
               LEFT JOIN suppliers s ON po.supplier_id = s.id
               LEFT JOIN equipment_instances ei ON po.equipment_instance_id = ei.id
               WHERE 1=1`;
    const params = [];
    if (supplier_id) { sql += " AND po.supplier_id = ?"; params.push(supplier_id); }
    if (status) { sql += " AND po.status = ?"; params.push(status); }
    if (equipment_instance_id) { sql += " AND po.equipment_instance_id = ?"; params.push(equipment_instance_id); }
    sql += " ORDER BY po.id DESC";
    res.json(all(sql, params));
  }));

  app.get("/api/purchase_orders/:id", wrap((req, res) => {
    const po = get(`SELECT po.*, s.supplier_name, s.contact_person, s.phone, ei.instance_code
                    FROM purchase_orders po
                    LEFT JOIN suppliers s ON po.supplier_id = s.id
                    LEFT JOIN equipment_instances ei ON po.equipment_instance_id = ei.id
                    WHERE po.id = ?`, req.params.id);
    if (!po) throw ApiError.notFound("PO not found");
    const lines = all(`SELECT pl.*, m.material_code, m.material_name
                        FROM po_lines pl
                        JOIN materials m ON pl.material_id = m.id
                        WHERE pl.po_id = ?
                        ORDER BY pl.line_no`, req.params.id);
    res.json(Object.assign({}, po, { lines }));
  }));

  app.post("/api/purchase_orders", wrap((req, res) => {
    const { supplier_id, equipment_instance_id, ordered_date, expected_date, payment_terms, currency, notes, created_by, lines } = req.body;
    if (!supplier_id || !Array.isArray(lines) || lines.length === 0) throw ApiError.validation("supplier_id / lines 必填且 lines 非空");
    const sup = get("SELECT id FROM suppliers WHERE id = ?", supplier_id);
    if (!sup) throw ApiError.notFound("supplier 不存在");

    const poNo = nextPoNo(db);
    let subtotal = 0;
    const taxAmount = 0;
    for (const line of lines) {
      subtotal += Number(line.quantity) * Number(line.unit_price);
    }
    const totalAmount = subtotal;

    const tx = db.transaction(() => {
      const result = run(`INSERT INTO purchase_orders (po_no, supplier_id, equipment_instance_id, status, ordered_date, expected_date, subtotal, tax_amount, total_amount, currency, payment_terms, created_by, notes)
                     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poNo, supplier_id, equipment_instance_id || null, ordered_date || null, expected_date || null, subtotal, taxAmount, totalAmount, currency || "CNY", payment_terms || null, created_by || null, notes || null]);
      const poId = result.lastInsertRowid;
      let lineNo = 1;
      for (const line of lines) {
        const amount = Number(line.quantity) * Number(line.unit_price);
        run(`INSERT INTO po_lines (po_id, material_id, quantity, unit, unit_price, line_amount, expected_date, line_no, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [poId, line.material_id, line.quantity, line.unit || null, line.unit_price, amount, line.expected_date || null, lineNo++, line.notes || null]);
      }
      return { id: poId, po_no: poNo, subtotal, total_amount: totalAmount };
    });

    const result = tx();
    ensureTrackingForPo(db, get, all, run, result.id);
    res.json(result);
  }));

  app.patch("/api/purchase_orders/:id/status", wrap((req, res) => {
    const { status, approved_by } = req.body;
    if (!PO_STATUSES.includes(status)) throw ApiError.validation("status 非法: " + status + " (允许: " + PO_STATUSES.join(", ") + ")");
    const po = get("SELECT id, status FROM purchase_orders WHERE id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    const fields = ["status = ?"];
    const params = [status];
    if (status === "confirmed" && approved_by) {
      fields.push("approved_by = ?", "approved_at = datetime('now')");
      params.push(approved_by);
    }
    if (status === "closed" || status === "cancelled") {
      fields.push("closed_at = datetime('now')");
    }
    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    run("UPDATE purchase_orders SET " + fields.join(", ") + " WHERE id = ?", params);
    ensureTrackingForPo(db, get, all, run, Number(req.params.id));
    res.json({ ok: true, status });
  }));

  app.post("/api/purchase_orders/:id/receive", wrap((req, res) => {
    const po = get("SELECT * FROM purchase_orders WHERE id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    if (!["submitted", "confirmed", "in_transit", "partially_received"].includes(po.status)) {
      throw ApiError.validation("当前 status=" + po.status + " 不允许收货");
    }
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) throw ApiError.validation("lines 必填");

    const tx = db.transaction(() => {
      const createdLots = [];
      for (const receivedLine of lines) {
        const line = get("SELECT * FROM po_lines WHERE id = ? AND po_id = ?", [receivedLine.line_id, po.id]);
        if (!line) throw ApiError.validation("line " + receivedLine.line_id + " 不属于此 PO");
        const recvQty = Number(receivedLine.received_qty);
        if (recvQty <= 0) throw ApiError.validation("line " + receivedLine.line_id + " received_qty 必须 > 0");
        if (line.received_qty + recvQty > line.quantity + 0.0001) {
          throw ApiError.validation("line " + receivedLine.line_id + " 收货超量: 已收 " + line.received_qty + " + 本次 " + recvQty + " > 订单 " + line.quantity);
        }

        const lotNo = receivedLine.lot_no || (po.po_no + "-L" + line.line_no + "-" + Date.now());
        const dup = get("SELECT id FROM material_lots WHERE lot_no = ?", lotNo);
        if (dup) throw ApiError.validation("lot_no 已存在: " + lotNo);
        const mat = get("SELECT unit FROM materials WHERE id = ?", line.material_id);
        const unit = line.unit || mat?.unit || "pcs";
        const location = receivedLine.location || "主仓库-A-01";
        const lotResult = run("INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 'pending', ?)",
          [line.material_id, lotNo, po.supplier_id ? null : null, receivedLine.heat_no || null, receivedLine.certificate_no || null, recvQty, unit, "收货自 " + po.po_no]);
        const lotId = lotResult.lastInsertRowid;
        run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')", [lotId, location, recvQty, unit]);
        run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, project_id, notes) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?)",
          [lotId, recvQty, unit, location, null, po.equipment_instance_id, "PO 收货: " + po.po_no + " line " + line.line_no]);

        const keyComponent = get("SELECT id, unit_price FROM key_components WHERE material_id = ?", line.material_id);
        if (keyComponent) {
          run("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, vendor_po, currency, valid_from, notes, priced_at) VALUES (?, ?, ?, ?, 'CNY', datetime('now'), ?, datetime('now'))",
            [keyComponent.id, line.unit_price, receivedLine.certificate_no || null, po.po_no, "收货自 PO " + po.po_no + " line " + line.line_no]);
        }

        run("UPDATE po_lines SET received_qty = received_qty + ?, lot_no_at_receipt = COALESCE(?, lot_no_at_receipt) WHERE id = ?",
          [recvQty, lotNo, line.id]);

        createdLots.push({ line_id: line.id, lot_id: lotId, lot_no: lotNo, received_qty: recvQty });
      }

      const total = get("SELECT SUM(quantity) AS q, SUM(received_qty) AS r FROM po_lines WHERE po_id = ?", po.id);
      const newStatus = (total.r >= total.q) ? "received" : "partially_received";
      run("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, po.id]);

      return { created_lots: createdLots, po_status: newStatus };
    });

    const result = tx();
    ensureTrackingForPo(db, get, all, run, po.id);
    res.json(result);
  }));
}

module.exports = {
  registerPurchaseOrderRoutes,
  PO_STATUSES,
};
