// services/purchase/orderRoutes.js
"use strict";

const { nextPoNo } = require("./_helpers");
const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");
const { PURCHASE_ORDER_STATUSES: PO_STATUSES } = require("../../app/domain/statusCatalog");
const { ensureTrackingForPo } = require("./trackingSync");
const audit = require("../../app/audit");

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isPositiveFinite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function isNonNegativeFinite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
}

const PO_TRANSITIONS = {
  draft: ["submitted", "cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["in_transit", "cancelled"],
  in_transit: ["cancelled"],
  partially_received: ["cancelled"],
  received: ["closed"],
  closed: [],
  cancelled: [],
};
const RECEIVE_DERIVED_STATUSES = ["partially_received", "received"];

function ensureReceivingSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_receiving (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    po_item_id INTEGER NOT NULL,
    received_qty REAL NOT NULL,
    quality_status TEXT NOT NULL DEFAULT 'pending',
    inspected_by INTEGER,
    lot_no TEXT NOT NULL,
    warehouse_location TEXT,
    received_at TEXT DEFAULT (datetime('now')),
    notes TEXT
  )`);
  const columns = new Set(db.prepare("PRAGMA table_info(purchase_receiving)").all().map((column) => column.name));
  if (!columns.has("material_lot_id")) db.prepare("ALTER TABLE purchase_receiving ADD COLUMN material_lot_id INTEGER").run();
  if (!columns.has("inventory_id")) db.prepare("ALTER TABLE purchase_receiving ADD COLUMN inventory_id INTEGER").run();
  if (!columns.has("inspection_id")) db.prepare("ALTER TABLE purchase_receiving ADD COLUMN inspection_id INTEGER").run();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_receiving_po ON purchase_receiving(po_id, po_item_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_receiving_lot ON purchase_receiving(lot_no);
  `);
}

function ensureInvoiceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    invoice_no TEXT NOT NULL,
    invoice_date TEXT,
    amount REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'CNY',
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_invoices_no ON purchase_invoices(invoice_no);
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po ON purchase_invoices(po_id);
  `);
}

function registerPurchaseOrderRoutes(app, db, helpers) {
  const { all, get, run } = helpers;
  ensureReceivingSchema(db);
  ensureInvoiceSchema(db);

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
    const receivingHistory = all(`SELECT pr.*, pl.material_id, m.material_code, m.material_name
                                   FROM purchase_receiving pr
                                   JOIN po_lines pl ON pl.id = pr.po_item_id
                                   LEFT JOIN materials m ON m.id = pl.material_id
                                   WHERE pr.po_id = ?
                                   ORDER BY pr.id`, req.params.id);
    const invoices = all("SELECT * FROM purchase_invoices WHERE po_id = ? ORDER BY id", req.params.id);
    const orderedAmount = Math.round(lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0) * 100) / 100;
    const receivedAmount = Math.round(lines.reduce((sum, line) => sum + Number(line.received_qty || 0) * Number(line.unit_price), 0) * 100) / 100;
    const invoicedAmount = Math.round(invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0) * 100) / 100;
    const invoicedTaxAmount = round2(invoices.reduce((sum, invoice) => sum + Number(invoice.tax_amount || 0), 0));
    const invoiceTotalAmount = round2(invoicedAmount + invoicedTaxAmount);
    const orderTaxAmount = round2(po.tax_amount || 0);
    const variance = Math.round((invoicedAmount - receivedAmount) * 100) / 100;
    const fullyReceived = lines.every((line) => Number(line.received_qty || 0) >= Number(line.quantity) - 0.0001);
    const reconciliation = {
      ordered_amount: orderedAmount,
      received_amount: receivedAmount,
      invoiced_amount: invoicedAmount,
      invoiced_tax_amount: invoicedTaxAmount,
      invoice_total_amount: invoiceTotalAmount,
      tax_variance: round2(invoicedTaxAmount - orderTaxAmount),
      over_invoiced: invoiceTotalAmount > receivedAmount + 0.01,
      variance,
      status: invoices.length === 0 ? "pending" : (Math.abs(variance) <= 0.01 ? "matched" : "variance"),
      fully_received: fullyReceived,
      invoice_count: invoices.length,
      invoices,
    };
    res.json(Object.assign({}, po, { lines, receiving_history: receivingHistory, reconciliation }));
  }));

  app.post("/api/purchase_orders", wrap((req, res) => {
    const { supplier_id, equipment_instance_id, ordered_date, expected_date, payment_terms, currency, notes, created_by, lines } = req.body;
    if (!supplier_id || !Array.isArray(lines) || lines.length === 0) throw ApiError.validation("supplier_id / lines 必填且 lines 非空");
    const sup = get("SELECT id, is_active FROM suppliers WHERE id = ?", supplier_id);
    if (!sup) throw ApiError.notFound("supplier 不存在");
    if (Number(sup.is_active) === 0) throw ApiError.validation("供应商已停用/列入黑名单，不能创建采购单");
    if (equipment_instance_id && !get("SELECT id FROM equipment_instances WHERE id = ?", equipment_instance_id)) {
      throw ApiError.notFound("关联项目不存在: " + equipment_instance_id);
    }

    for (const line of lines) {
      if (!line.material_id) throw ApiError.validation("lines[].material_id 必填");
      if (!isPositiveFinite(line.quantity)) throw ApiError.validation("lines[].quantity 必须是 > 0 的有限数字");
      if (!isNonNegativeFinite(line.unit_price)) throw ApiError.validation("lines[].unit_price 必须是 >= 0 的有限数字");
      if (!get("SELECT id FROM materials WHERE id = ?", line.material_id)) throw ApiError.notFound("物料不存在: " + line.material_id);
    }
    const createdBy = (req.user && req.user.uid) || created_by || null;
    const poNo = nextPoNo(db);
    let subtotal = 0;
    const taxAmount = 0;
    for (const line of lines) {
      subtotal += Number(line.quantity) * Number(line.unit_price);
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const totalAmount = subtotal;

    const tx = db.transaction(() => {
      const result = run(`INSERT INTO purchase_orders (po_no, supplier_id, equipment_instance_id, status, ordered_date, expected_date, subtotal, tax_amount, total_amount, currency, payment_terms, created_by, notes)
                     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poNo, supplier_id, equipment_instance_id || null, ordered_date || null, expected_date || null, subtotal, taxAmount, totalAmount, currency || "CNY", payment_terms || null, createdBy, notes || null]);
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
    audit.record(db, req, {
      action: "purchase_order.create",
      resource_type: "purchase_order",
      resource_id: result.id,
      after: {
        po_no: result.po_no,
        supplier_id,
        equipment_instance_id: equipment_instance_id || null,
        subtotal: result.subtotal,
        total_amount: result.total_amount,
        line_count: lines.length,
      },
      diff_summary: "创建采购单 " + result.po_no + "，金额 " + result.total_amount,
    });
    res.json(result);
  }));

  app.patch("/api/purchase_orders/:id/status", wrap((req, res) => {
    const { status, approved_by } = req.body;
    if (!PO_STATUSES.includes(status)) throw ApiError.validation("status 非法: " + status + " (允许: " + PO_STATUSES.join(", ") + ")");
    const po = get("SELECT id, po_no, status, created_by FROM purchase_orders WHERE id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    if (approved_by !== undefined && approved_by !== null && !Number.isInteger(Number(approved_by))) {
      throw ApiError.validation("approved_by 必须是用户 ID");
    }
    if (po.status === status) throw ApiError.validation("采购单已经是「" + status + "」状态");
    if (RECEIVE_DERIVED_STATUSES.includes(status)) {
      throw ApiError.validation("「" + status + "」只能由收货接口推进，不能手工设置");
    }
    if (["closed", "cancelled"].includes(status)) {
      const permissions = req.user?.permissions || [];
      const isAdminRole = String(req.user?.role || "").toLowerCase() === "admin";
      if (!isAdminRole && !permissions.includes("*") && !permissions.includes("purchase:admin")) {
        throw ApiError.forbidden("关闭/作废采购单需要 purchase:admin（高危操作）");
      }
    }
    const allowed = PO_TRANSITIONS[po.status] || [];
    if (!allowed.includes(status)) {
      throw ApiError.validation("采购单不能从「" + po.status + "」变更为「" + status + "」", { allowed_transitions: allowed });
    }
    const fields = ["status = ?"];
    const params = [status];
    if (status === "confirmed") {
      if (!approved_by) throw ApiError.validation("确认采购单必须提供 approved_by（审批人）");
      const approver = get("SELECT id, full_name FROM users WHERE id = ?", approved_by);
      if (!approver) throw ApiError.validation("approved_by 用户不存在: " + approved_by);
      if (po.created_by && Number(po.created_by) === Number(approved_by)) {
        throw ApiError.validation("审批人不能与创建人相同（职责分离）");
      }
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
    audit.record(db, req, {
      action: "purchase_order.status",
      resource_type: "purchase_order",
      resource_id: po.id,
      before: { status: po.status },
      after: { status, approved_by: status === "confirmed" ? Number(approved_by) : null },
      diff_summary: "采购单 " + po.po_no + " 状态 " + po.status + " → " + status,
    });
    res.json({ ok: true, status });
  }));

  app.post("/api/purchase_orders/:id/receive", wrap((req, res) => {
    const po = get("SELECT * FROM purchase_orders WHERE id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    if (!["confirmed", "in_transit", "partially_received"].includes(po.status)) {
      throw ApiError.validation("当前 status=" + po.status + " 不允许收货（须先审批确认）", {
        allowed_statuses: ["confirmed", "in_transit", "partially_received"],
      });
    }
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) throw ApiError.validation("lines 必填");

    const tx = db.transaction(() => {
      const createdLots = [];
      for (const receivedLine of lines) {
        const line = get("SELECT * FROM po_lines WHERE id = ? AND po_id = ?", [receivedLine.line_id, po.id]);
        if (!line) throw ApiError.validation("line " + receivedLine.line_id + " 不属于此 PO");
        const recvQty = Number(receivedLine.received_qty);
        if (!Number.isFinite(recvQty) || recvQty <= 0) throw ApiError.validation("line " + receivedLine.line_id + " received_qty 必须是 > 0 的有限数字");
        if (line.received_qty + recvQty > line.quantity + 0.0001) {
          throw ApiError.validation("line " + receivedLine.line_id + " 收货超量: 已收 " + line.received_qty + " + 本次 " + recvQty + " > 订单 " + line.quantity);
        }

        const supplierName = po.supplier_id ? (get("SELECT supplier_name FROM suppliers WHERE id = ?", po.supplier_id) || {}).supplier_name || null : null;
        const lotNo = receivedLine.lot_no || (po.po_no + "-L" + line.line_no + "-" + Date.now());
        const dup = get("SELECT id FROM material_lots WHERE lot_no = ?", lotNo);
        if (dup) throw ApiError.validation("lot_no 已存在: " + lotNo);
        const mat = get("SELECT unit FROM materials WHERE id = ?", line.material_id);
        const unit = line.unit || mat?.unit || "pcs";
        const location = receivedLine.location || "主仓库-A-01";
        const lotResult = run("INSERT INTO material_lots (material_id, lot_no, supplier, heat_no, certificate_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 'pending', ?)",
          [line.material_id, lotNo, supplierName, receivedLine.heat_no || null, receivedLine.certificate_no || null, recvQty, unit, "收货自 " + po.po_no]);
        const lotId = lotResult.lastInsertRowid;
        const inventoryResult = run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'quarantined')", [lotId, location, recvQty, unit]);
        const receivingResult = run(`
          INSERT INTO purchase_receiving
            (po_id, po_item_id, received_qty, quality_status, lot_no, warehouse_location, material_lot_id, inventory_id, notes)
          VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
        `, [po.id, line.id, recvQty, lotNo, location, lotId, inventoryResult.lastInsertRowid, receivedLine.notes || "待来料检验"]);
        run("INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, project_id, notes) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?)",
          [lotId, recvQty, unit, location, null, po.equipment_instance_id, "PO 收货: " + po.po_no + " line " + line.line_no]);

        const keyComponent = get("SELECT id, unit_price FROM key_components WHERE material_id = ?", line.material_id);
        if (keyComponent) {
          run("INSERT INTO key_component_prices (key_component_id, actual_price, contract_no, vendor_po, currency, valid_from, notes, priced_at) VALUES (?, ?, ?, ?, 'CNY', datetime('now'), ?, datetime('now'))",
            [keyComponent.id, line.unit_price, receivedLine.certificate_no || null, po.po_no, "收货自 PO " + po.po_no + " line " + line.line_no]);
        }

        run("UPDATE po_lines SET received_qty = received_qty + ?, lot_no_at_receipt = COALESCE(?, lot_no_at_receipt) WHERE id = ?",
          [recvQty, lotNo, line.id]);

        createdLots.push({ receiving_id: receivingResult.lastInsertRowid, line_id: line.id, lot_id: lotId, lot_no: lotNo, received_qty: recvQty, quality_status: "pending", inventory_status: "quarantined" });
      }

      const total = get("SELECT SUM(quantity) AS q, SUM(received_qty) AS r FROM po_lines WHERE po_id = ?", po.id);
      const newStatus = (total.r >= total.q) ? "received" : "partially_received";
      run("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, po.id]);

      return { created_lots: createdLots, po_status: newStatus };
    });

    const result = tx();
    ensureTrackingForPo(db, get, all, run, po.id);
    audit.record(db, req, {
      action: "purchase_order.receive",
      resource_type: "purchase_order",
      resource_id: po.id,
      before: { status: po.status },
      after: {
        status: result.po_status,
        received_qty: round2(result.created_lots.reduce((sum, lot) => sum + Number(lot.received_qty || 0), 0)),
        receiving_ids: result.created_lots.map((lot) => lot.receiving_id),
      },
      diff_summary: "采购收货 " + po.po_no + "（" + result.created_lots.length + " 行），状态 " + po.status + " → " + result.po_status,
    });
    res.json(result);
  }));

  // ---- 对账：录入发票 / 对账汇总 / 发票状态 ----
  app.post("/api/purchase_orders/:id/invoices", wrap((req, res) => {
    const po = get("SELECT * FROM purchase_orders WHERE id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    if (!["partially_received", "received", "closed"].includes(po.status)) {
      throw ApiError.validation("只有已收货/部分收货的采购单可以录入发票（当前 " + po.status + "）");
    }
    const { invoice_no, invoice_date, amount, tax_amount, notes } = req.body;
    const invoiceNo = typeof invoice_no === "string" ? invoice_no.trim() : "";
    if (!invoiceNo) throw ApiError.validation("invoice_no 必填");
    if (invoiceNo.length > 64) throw ApiError.validation("invoice_no 长度不能超过 64");
    if (!isPositiveFinite(amount)) throw ApiError.validation("amount 必须是 > 0 的有限数字");
    if (!isNonNegativeFinite(tax_amount === undefined || tax_amount === null ? 0 : tax_amount)) {
      throw ApiError.validation("tax_amount 必须是 >= 0 的有限数字");
    }
    if (Number(tax_amount || 0) > Number(amount)) throw ApiError.validation("tax_amount 不能大于 amount");
    if (get("SELECT id FROM purchase_invoices WHERE invoice_no = ?", invoiceNo)) {
      throw ApiError.validation("发票号已存在: " + invoiceNo);
    }
    const created = run(`INSERT INTO purchase_invoices (po_id, invoice_no, invoice_date, amount, tax_amount, currency, status, notes)
                         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [po.id, invoiceNo, invoice_date || null, round2(amount), round2(tax_amount || 0), po.currency || "CNY", notes || null]);
    audit.record(db, req, {
      action: "purchase_invoice.create",
      resource_type: "purchase_invoice",
      resource_id: created.lastInsertRowid,
      after: { po_id: po.id, invoice_no: invoiceNo, amount: round2(amount), tax_amount: round2(tax_amount || 0) },
      diff_summary: "采购单 " + po.po_no + " 录入发票 " + invoiceNo + "，金额 " + round2(amount),
    });
    res.json({ id: created.lastInsertRowid, invoice_no: invoiceNo, po_id: po.id });
  }));

  app.get("/api/purchase_orders/:id/reconciliation", wrap((req, res) => {
    const po = get("SELECT po.*, s.supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?", req.params.id);
    if (!po) throw ApiError.notFound("PO 不存在");
    const lines = all(`SELECT pl.*, m.material_code, m.material_name
                       FROM po_lines pl LEFT JOIN materials m ON m.id = pl.material_id
                       WHERE pl.po_id = ? ORDER BY pl.line_no`, po.id).map((line) => {
      const orderedAmount = Math.round(Number(line.quantity) * Number(line.unit_price) * 100) / 100;
      const receivedAmount = Math.round(Number(line.received_qty || 0) * Number(line.unit_price) * 100) / 100;
      return Object.assign({}, line, {
        ordered_amount: orderedAmount,
        received_amount: receivedAmount,
        remaining_qty: Math.max(0, Math.round((Number(line.quantity) - Number(line.received_qty || 0)) * 1000) / 1000),
      });
    });
    const invoices = all("SELECT * FROM purchase_invoices WHERE po_id = ? ORDER BY id", po.id);
    const orderedAmount = Math.round(lines.reduce((sum, line) => sum + line.ordered_amount, 0) * 100) / 100;
    const receivedAmount = Math.round(lines.reduce((sum, line) => sum + line.received_amount, 0) * 100) / 100;
    const invoicedAmount = Math.round(invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0) * 100) / 100;
    const invoicedTaxAmount = round2(invoices.reduce((sum, invoice) => sum + Number(invoice.tax_amount || 0), 0));
    const invoiceTotalAmount = round2(invoicedAmount + invoicedTaxAmount);
    const orderTaxAmount = round2(po.tax_amount || 0);
    const variance = Math.round((invoicedAmount - receivedAmount) * 100) / 100;
    const fullyReceived = lines.every((line) => Number(line.received_qty || 0) >= Number(line.quantity) - 0.0001);
    let status = "pending";
    if (invoices.length > 0) status = Math.abs(variance) <= 0.01 ? "matched" : "variance";
    res.json({
      po: {
        id: po.id, po_no: po.po_no, status: po.status, supplier_id: po.supplier_id,
        supplier_name: po.supplier_name, currency: po.currency, total_amount: po.total_amount,
        approved_by: po.approved_by, approved_at: po.approved_at,
      },
      lines,
      invoices,
      summary: {
        ordered_amount: orderedAmount,
        received_amount: receivedAmount,
        invoiced_amount: invoicedAmount,
        invoiced_tax_amount: invoicedTaxAmount,
        invoice_total_amount: invoiceTotalAmount,
        tax_variance: round2(invoicedTaxAmount - orderTaxAmount),
        over_invoiced: invoiceTotalAmount > receivedAmount + 0.01,
        variance,
        status,
        fully_received: fullyReceived,
        invoice_count: invoices.length,
        ordered_qty: Math.round(lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0) * 1000) / 1000,
        received_qty: Math.round(lines.reduce((sum, line) => sum + Number(line.received_qty || 0), 0) * 1000) / 1000,
      },
    });
  }));

  app.patch("/api/purchase_invoices/:id", wrap((req, res) => {
    const invoice = get("SELECT * FROM purchase_invoices WHERE id = ?", req.params.id);
    if (!invoice) throw ApiError.notFound("发票不存在");
    const { status } = req.body;
    const transitions = { pending: ["matched", "void"], matched: ["paid"], void: [], paid: [] };
    if (!Object.keys(transitions).includes(status)) throw ApiError.validation("status 必须是 pending/matched/paid/void");
    if (!(transitions[invoice.status] || []).includes(status)) {
      throw ApiError.validation("发票不能从「" + invoice.status + "」变更为「" + status + "」", { allowed_transitions: transitions[invoice.status] || [] });
    }
    if (status === "matched") {
      const totals = get(`SELECT
          COALESCE((SELECT SUM(COALESCE(received_qty, 0) * unit_price) FROM po_lines WHERE po_id = ?), 0) AS received_amount,
          COALESCE((SELECT SUM(amount) FROM purchase_invoices WHERE po_id = ? AND status != 'void' AND id != ?), 0) AS other_invoiced`,
        [invoice.po_id, invoice.po_id, invoice.id]);
      const invoicedAmount = round2(Number(totals.other_invoiced) + Number(invoice.amount || 0));
      const receivedAmount = round2(totals.received_amount);
      const variance = round2(invoicedAmount - receivedAmount);
      if (Math.abs(variance) > 0.01) {
        throw ApiError.conflict("发票净额与已收货金额不一致，不能标记为 matched", {
          po_id: invoice.po_id,
          invoiced_amount: invoicedAmount,
          received_amount: receivedAmount,
          variance,
        });
      }
    }
    run("UPDATE purchase_invoices SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, invoice.id]);
    audit.record(db, req, {
      action: "purchase_invoice.status",
      resource_type: "purchase_invoice",
      resource_id: invoice.id,
      before: { status: invoice.status },
      after: { status },
      diff_summary: "发票 " + invoice.invoice_no + " 状态 " + invoice.status + " → " + status,
    });
    res.json({ ok: true, status });
  }));
}

module.exports = {
  ensureReceivingSchema,
  registerPurchaseOrderRoutes,
  PO_STATUSES,
};
