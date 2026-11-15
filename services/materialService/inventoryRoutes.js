"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { queryLowStock } = require("../material/core");

function registerInventoryRoutes({ app, db, helpers, ApiError }) {
  const { all, get } = helpers;
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  app.get("/api/inventory", wrap((_req, res) => {
    // 2026-11-07: 前端库存清单有"编码"列, 但原 SQL 没查 material_code (列一直空白)
    res.json(all("SELECT i.*, ml.lot_no, m.id AS material_id, m.material_code, m.material_name FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id ORDER BY m.material_code, i.location, ml.lot_no"));
  }));

  app.get("/api/inventory/alerts", wrap((_req, res) => {
    const rows = queryLowStock(db, { includeSpec: true });
    res.json({ count: rows.length, items: rows });
  }));

  function nextPrNo() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = get("SELECT COUNT(*) c FROM purchase_requisitions WHERE pr_no LIKE ?", [`PR-${day}-%`]);
    return `PR-${day}-${String(Number(row?.c || 0) + 1).padStart(3, "0")}`;
  }

  app.post("/api/inventory/purchase-requisitions", wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw ApiError.validation("items 必填");
    if (items.length > 200) throw ApiError.validation("items 单次最多 200 条");
    const normalized = [];
    for (const item of items) {
      const materialId = Number(item.material_id);
      const quantity = Number(item.quantity);
      if (!materialId || !(quantity > 0)) throw ApiError.validation("material_id/quantity 必须有效");
      const material = get("SELECT id, unit, default_supplier, estimated_unit_price FROM materials WHERE id = ?", [materialId]);
      if (!material) throw ApiError.notFound("物料不存在: " + materialId);
      const supplier = material.default_supplier ? get("SELECT id FROM suppliers WHERE supplier_name = ? LIMIT 1", [material.default_supplier]) : null;
      normalized.push({
        material_id: materialId,
        quantity,
        unit: item.unit || material.unit || "件",
        priority: item.priority || "P3",
        suggested_date: item.suggested_date || null,
        notes: item.notes || null,
        supplier_id: supplier?.id || null,
        unit_price: Number(material.estimated_unit_price || item.unit_price || 0),
      });
    }
    const requestedBy = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const prNo = nextPrNo();
    const tx = db.transaction(() => {
      const result = run("INSERT INTO purchase_requisitions (pr_no, status, requested_by, notes) VALUES (?, 'draft', ?, ?)",
        [prNo, requestedBy, req.body?.notes || "低库存自动补货建议生成"]);
      const prId = result.lastInsertRowid;
      for (const item of normalized) {
        run(`INSERT INTO purchase_requisition_items (pr_id, material_id, quantity, unit, priority, suggested_date, notes, supplier_id, unit_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [prId, item.material_id, item.quantity, item.unit, item.priority, item.suggested_date, item.notes, item.supplier_id, item.unit_price]);
      }
      return { id: Number(prId), pr_no: prNo, item_count: normalized.length };
    });
    res.json({ ok: true, ...tx() });
  }));

  app.get("/api/inventory/purchase-requisitions", wrap((req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const rows = all("SELECT * FROM purchase_requisitions ORDER BY id DESC LIMIT ?", [limit]);
    for (const row of rows) {
      row.items = all(`SELECT pri.*, m.material_code, m.material_name, s.supplier_name
                         FROM purchase_requisition_items pri
                         JOIN materials m ON m.id = pri.material_id
                         LEFT JOIN suppliers s ON s.id = pri.supplier_id
                        WHERE pri.pr_id = ? ORDER BY pri.id`, [row.id]);
      row.purchase_orders = all("SELECT po_id, po_no FROM purchase_requisition_po_links WHERE pr_id = ? ORDER BY id", [row.id]);
    }
    res.json(rows);
  }));

  function prOrThrow(id) {
    const pr = get("SELECT * FROM purchase_requisitions WHERE id = ?", [id]);
    if (!pr) throw ApiError.notFound("采购申请不存在");
    return pr;
  }
  function currentUserId(req) {
    return (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
  }

  app.post("/api/inventory/purchase-requisitions/:id/submit", wrap((req, res) => {
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "draft") throw ApiError.validation("只有草稿状态可以提交");
    run("UPDATE purchase_requisitions SET status='submitted', submitted_at=datetime('now'), submitted_by=?, updated_at=datetime('now') WHERE id=?", [currentUserId(req), pr.id]);
    res.json({ ok: true, status: "submitted" });
  }));

  app.post("/api/inventory/purchase-requisitions/:id/approve", wrap((req, res) => {
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "submitted") throw ApiError.validation("只有已提交状态可以审批");
    run("UPDATE purchase_requisitions SET status='approved', approved_at=datetime('now'), approved_by=?, reject_reason=NULL, updated_at=datetime('now') WHERE id=?", [currentUserId(req), pr.id]);
    res.json({ ok: true, status: "approved" });
  }));

  app.post("/api/inventory/purchase-requisitions/:id/reject", wrap((req, res) => {
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "submitted") throw ApiError.validation("只有已提交状态可以驳回");
    run("UPDATE purchase_requisitions SET status='rejected', rejected_at=datetime('now'), rejected_by=?, reject_reason=?, updated_at=datetime('now') WHERE id=?", [currentUserId(req), req.body?.reason || null, pr.id]);
    res.json({ ok: true, status: "rejected" });
  }));

  function nextPoNo() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = get("SELECT COUNT(*) c FROM purchase_orders WHERE po_no LIKE ?", [`PO-${day}-%`]);
    return `PO-${day}-${String(Number(row?.c || 0) + 1).padStart(3, "0")}`;
  }

  app.post("/api/inventory/purchase-requisitions/:id/convert", wrap((req, res) => {
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "approved") throw ApiError.validation("只有已审批的采购申请可以转采购订单");
    const items = all(`SELECT pri.*, m.material_code, m.material_name, s.supplier_name
                         FROM purchase_requisition_items pri
                         JOIN materials m ON m.id = pri.material_id
                         LEFT JOIN suppliers s ON s.id = pri.supplier_id
                        WHERE pri.pr_id = ? ORDER BY pri.id`, [pr.id]);
    if (!items.length) throw ApiError.validation("采购申请没有明细");
    const fallbackSupplierId = req.body?.supplier_id ? Number(req.body.supplier_id) : null;
    if (fallbackSupplierId && !get("SELECT id FROM suppliers WHERE id = ?", [fallbackSupplierId])) throw ApiError.validation("指定的供应商不存在");
    for (const item of items) {
      if (!item.supplier_id && fallbackSupplierId) item.supplier_id = fallbackSupplierId;
    }
    const missingSupplier = items.filter((item) => !item.supplier_id);
    if (missingSupplier.length) throw ApiError.validation("以下物料缺少供应商，请选择供应商后再转采购订单: " + missingSupplier.map((item) => item.material_code).join("、"));
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.supplier_id)) groups.set(item.supplier_id, []);
      groups.get(item.supplier_id).push(item);
    }
    const created = [];
    const tx = db.transaction(() => {
      for (const [supplierId, lines] of groups) {
        const poNo = nextPoNo();
        const subtotal = Math.round(lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price || 0), 0) * 100) / 100;
        const expectedDate = lines.map((line) => line.suggested_date).filter(Boolean).sort()[0] || null;
        const result = run(`INSERT INTO purchase_orders
          (po_no, supplier_id, equipment_instance_id, status, ordered_date, expected_date, subtotal, tax_amount, total_amount, currency, payment_terms, created_by, notes)
          VALUES (?, ?, NULL, 'draft', date('now'), ?, ?, 0, ?, 'CNY', NULL, ?, ?)`,
          [poNo, supplierId, expectedDate, subtotal, subtotal, currentUserId(req), `由采购申请 ${pr.pr_no} 转入`]);
        const poId = Number(result.lastInsertRowid);
        let lineNo = 1;
        for (const line of lines) {
          const amount = Math.round(Number(line.quantity) * Number(line.unit_price || 0) * 100) / 100;
          run(`INSERT INTO po_lines (po_id, material_id, quantity, unit, unit_price, line_amount, expected_date, line_no, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [poId, line.material_id, line.quantity, line.unit, Number(line.unit_price || 0), amount, line.suggested_date, lineNo++, `PR ${pr.pr_no}`]);
        }
        run("INSERT INTO purchase_requisition_po_links (pr_id, po_id, po_no) VALUES (?, ?, ?)", [pr.id, poId, poNo]);
        created.push({ po_id: poId, po_no: poNo, supplier_id: supplierId, item_count: lines.length, total_amount: subtotal });
      }
      run("UPDATE purchase_requisitions SET status='converted', converted_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [pr.id]);
      return created;
    });
    res.json({ ok: true, status: "converted", purchase_orders: tx() });
  }));

  app.get("/api/inventory/lot_trace", wrap((req, res) => {
    const { lot_id } = req.query;
    if (!lot_id) throw ApiError.validation("lot_id 必填");
    const lot = get("SELECT ml.*, m.material_code, m.material_name FROM material_lots ml JOIN materials m ON ml.material_id = m.id WHERE ml.id = ?", lot_id);
    if (!lot) throw ApiError.notFound("lot 不存在");
    const movements = all("SELECT * FROM material_movements WHERE material_lot_id = ? ORDER BY created_at", lot_id);
    const inventory = all("SELECT * FROM inventory WHERE material_lot_id = ?", lot_id);
    res.json({ lot, movements, inventory });
  }));
}

module.exports = { registerInventoryRoutes };
