"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { queryLowStock } = require("../material/core");
const { ensureTrackingForPo } = require("../purchase/trackingSync");

function registerInventoryRoutes({ app, db, helpers, ApiError }) {
  const { all, get } = helpers;
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  app.get("/api/inventory", wrap((_req, res) => {
    // 2026-11-07: 前端库存清单有"编码"列, 但原 SQL 没查 material_code (列一直空白)
    const hasEquipment = get("SELECT name FROM sqlite_master WHERE type='table' AND name='equipment_instances'");
    const projectSelect = hasEquipment ? ", ei.instance_code AS project_code" : ", NULL AS project_code";
    const projectJoin = hasEquipment ? " LEFT JOIN equipment_instances ei ON ei.id = i.project_id" : "";
    res.json(all(`SELECT i.*, ml.lot_no, m.id AS material_id, m.material_code, m.material_name${projectSelect}
                    FROM inventory i JOIN material_lots ml ON i.material_lot_id = ml.id JOIN materials m ON ml.material_id = m.id${projectJoin}
                   ORDER BY m.material_code, i.location, ml.lot_no`));
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
  function canApprove(req) {
    const user = req.user || {};
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    return user.role === "admin" || user.role === "purchase_supervisor" || permissions.includes("*") || permissions.includes("purchase:approve");
  }

  app.post("/api/inventory/purchase-requisitions/:id/submit", wrap((req, res) => {
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "draft") throw ApiError.validation("只有草稿状态可以提交");
    run("UPDATE purchase_requisitions SET status='submitted', submitted_at=datetime('now'), submitted_by=?, updated_at=datetime('now') WHERE id=?", [currentUserId(req), pr.id]);
    res.json({ ok: true, status: "submitted" });
  }));

  app.post("/api/inventory/purchase-requisitions/:id/approve", wrap((req, res) => {
    if (!canApprove(req)) throw ApiError.forbidden("无权审批采购申请");
    const pr = prOrThrow(Number(req.params.id));
    if (pr.status !== "submitted") throw ApiError.validation("只有已提交状态可以审批");
    run("UPDATE purchase_requisitions SET status='approved', approved_at=datetime('now'), approved_by=?, reject_reason=NULL, updated_at=datetime('now') WHERE id=?", [currentUserId(req), pr.id]);
    res.json({ ok: true, status: "approved" });
  }));

  app.post("/api/inventory/purchase-requisitions/:id/reject", wrap((req, res) => {
    if (!canApprove(req)) throw ApiError.forbidden("无权驳回采购申请");
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
    if (fallbackSupplierId) {
      const fallbackSupplier = get("SELECT id, is_active FROM suppliers WHERE id = ?", [fallbackSupplierId]);
      if (!fallbackSupplier) throw ApiError.validation("指定的供应商不存在");
      if (Number(fallbackSupplier.is_active) === 0) throw ApiError.validation("指定的供应商已停用");
    }
    for (const item of items) {
      if (!item.supplier_id && fallbackSupplierId) item.supplier_id = fallbackSupplierId;
    }
    const missingSupplier = items.filter((item) => !item.supplier_id);
    if (missingSupplier.length) throw ApiError.validation("以下物料缺少供应商，请选择供应商后再转采购订单: " + missingSupplier.map((item) => item.material_code).join("、"));
    for (const supplierId of [...new Set(items.map((item) => item.supplier_id))]) {
      const supplier = get("SELECT id, supplier_name, is_active FROM suppliers WHERE id = ?", [supplierId]);
      if (!supplier) throw ApiError.validation("供应商不存在: " + supplierId);
      if (Number(supplier.is_active) === 0) throw ApiError.validation("供应商已停用，不能转采购订单: " + supplier.supplier_name);
    }
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
        ensureTrackingForPo(db, get, all, run, poId);
        created.push({ po_id: poId, po_no: poNo, supplier_id: supplierId, item_count: lines.length, total_amount: subtotal });
      }
      run("UPDATE purchase_requisitions SET status='converted', converted_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [pr.id]);
      return created;
    });
    res.json({ ok: true, status: "converted", purchase_orders: tx() });
  }));

  app.get("/api/project-inventory", wrap((req, res) => {
    const equipmentId = Number(req.query.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    res.json(all(`SELECT i.*, ml.lot_no, ml.quality_status, ml.unit_cost,
                         m.id AS material_id, m.material_code, m.material_name, m.unit AS material_unit,
                         COALESCE(NULLIF(ml.unit_cost, 0), NULLIF(m.actual_unit_price, 0), m.estimated_unit_price, 0) AS effective_unit_cost,
                         i.quantity * COALESCE(NULLIF(ml.unit_cost, 0), NULLIF(m.actual_unit_price, 0), m.estimated_unit_price, 0) AS inventory_value
                    FROM inventory i
                    JOIN material_lots ml ON ml.id = i.material_lot_id
                    JOIN materials m ON m.id = ml.material_id
                   WHERE i.project_id = ? AND i.quantity > 0
                   ORDER BY m.material_code, i.location, ml.lot_no`, [equipmentId]));
  }));

  app.post("/api/project-inventory/issue", wrap((req, res) => {
    const inventoryId = Number(req.body?.inventory_id);
    const quantity = Number(req.body?.quantity);
    if (!inventoryId || !(quantity > 0)) throw ApiError.validation("inventory_id/quantity 必须有效");
    const row = get(`SELECT i.*, ml.unit_cost, m.material_code, m.actual_unit_price, m.estimated_unit_price
                       FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id JOIN materials m ON m.id=ml.material_id
                      WHERE i.id = ?`, [inventoryId]);
    if (!row) throw ApiError.notFound("项目库存不存在");
    if (!row.project_id) throw ApiError.validation("该库存不是项目直供库存");
    if (row.status !== "available") throw ApiError.validation("该批次状态为 " + row.status + "，不能领料");
    if (quantity > Number(row.quantity) + 1e-6) throw ApiError.validation("领料数量超过项目库存: 可用 " + row.quantity);
    const operatorId = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const unitCost = Number(row.unit_cost || row.actual_unit_price || row.estimated_unit_price || 0);
    const amount = Math.round(unitCost * quantity * 100) / 100;
    const tx = db.transaction(() => {
      run("UPDATE inventory SET quantity = quantity - ?, last_updated = datetime('now') WHERE id = ?", [quantity, inventoryId]);
      const movement = run(`INSERT INTO material_movements
        (material_lot_id, movement_type, quantity, unit, from_location, work_order_id, operator_id, notes, equipment_instance_id, unit_cost, amount)
        VALUES (?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.material_lot_id, quantity, row.unit || "件", row.location, req.body?.work_order_id || null, operatorId,
          req.body?.notes || "项目直供领料", row.project_id, unitCost, amount]);
      let costEntryId = null;
      try {
        if (get("SELECT name FROM sqlite_master WHERE type='table' AND name='project_cost_entries'")) {
          const entry = run(`INSERT INTO project_cost_entries
            (equipment_instance_id, work_order_id, cost_type, source_type, source_ref, description, amount, occurred_on, status, notes, created_by)
            VALUES (?, ?, 'material', 'project_issue', ?, ?, ?, date('now'), 'posted', ?, ?)`,
            [row.project_id, req.body?.work_order_id || null, String(movement.lastInsertRowid), "项目直供领料 " + row.material_code + " × " + quantity, amount, req.body?.notes || null, operatorId]);
          costEntryId = Number(entry.lastInsertRowid);
        }
      } catch (_error) { /* 旧库无成本表时忽略 */ }
      return { inventory_id: inventoryId, material_code: row.material_code, quantity, equipment_instance_id: row.project_id, unit_cost: unitCost, amount, cost_entry_id: costEntryId };
    });
    res.json({ ok: true, ...tx() });
  }));

  app.post("/api/project-inventory/return", wrap((req, res) => {
    const inventoryId = Number(req.body?.inventory_id);
    const quantity = Number(req.body?.quantity);
    if (!inventoryId || !(quantity > 0)) throw ApiError.validation("inventory_id/quantity 必须有效");
    const row = get(`SELECT i.*, ml.unit_cost, m.material_code, m.actual_unit_price, m.estimated_unit_price
                       FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id JOIN materials m ON m.id=ml.material_id
                      WHERE i.id = ?`, [inventoryId]);
    if (!row) throw ApiError.notFound("项目库存不存在");
    if (!row.project_id) throw ApiError.validation("该库存不是项目直供库存");
    const operatorId = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const unitCost = Number(row.unit_cost || row.actual_unit_price || row.estimated_unit_price || 0);
    const amount = Math.round(unitCost * quantity * 100) / 100;
    const tx = db.transaction(() => {
      run("UPDATE inventory SET quantity = quantity + ?, last_updated = datetime('now') WHERE id = ?", [quantity, inventoryId]);
      const movement = run(`INSERT INTO material_movements
        (material_lot_id, movement_type, quantity, unit, to_location, work_order_id, operator_id, notes, equipment_instance_id, unit_cost, amount)
        VALUES (?, 'return', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.material_lot_id, quantity, row.unit || "件", row.location, req.body?.work_order_id || null, operatorId,
          req.body?.notes || "项目直供退料", row.project_id, unitCost, amount]);
      let costEntryId = null;
      try {
        if (get("SELECT name FROM sqlite_master WHERE type='table' AND name='project_cost_entries'")) {
          const entry = run(`INSERT INTO project_cost_entries
            (equipment_instance_id, work_order_id, cost_type, source_type, source_ref, description, amount, occurred_on, status, notes, created_by)
            VALUES (?, ?, 'material', 'project_return', ?, ?, ?, date('now'), 'posted', ?, ?)`,
            [row.project_id, req.body?.work_order_id || null, String(movement.lastInsertRowid), "项目直供退料冲减 " + row.material_code + " × " + quantity, -amount, req.body?.notes || null, operatorId]);
          costEntryId = Number(entry.lastInsertRowid);
        }
      } catch (_error) { /* 旧库无成本表时忽略 */ }
      return { inventory_id: inventoryId, material_code: row.material_code, quantity, equipment_instance_id: row.project_id, unit_cost: unitCost, amount, cost_entry_id: costEntryId };
    });
    res.json({ ok: true, ...tx() });
  }));

  app.get("/api/project-inventory/movements", wrap((req, res) => {
    const equipmentId = Number(req.query.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    res.json(all(`SELECT mm.*, m.material_code, m.material_name, ml.lot_no
                    FROM material_movements mm
                    JOIN material_lots ml ON ml.id = mm.material_lot_id
                    JOIN materials m ON m.id = ml.material_id
                   WHERE mm.equipment_instance_id = ?
                   ORDER BY mm.id DESC LIMIT 200`, [equipmentId]));
  }));

  app.get("/api/project-inventory/closures", wrap((req, res) => {
    const equipmentId = Number(req.query.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    const closures = all("SELECT * FROM project_inventory_closures WHERE equipment_instance_id = ? ORDER BY id DESC LIMIT 50", [equipmentId]);
    for (const closure of closures) {
      closure.items = all(`SELECT pci.*, m.material_code, m.material_name, ml.lot_no
                             FROM project_inventory_closure_items pci
                             LEFT JOIN materials m ON m.id = pci.material_id
                             LEFT JOIN material_lots ml ON ml.id = pci.material_lot_id
                            WHERE pci.closure_id = ? ORDER BY pci.id`, [closure.id]);
    }
    res.json(closures);
  }));

  function canApproveClosure(req) {
    const user = req.user || {};
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    return user.role === "admin" || permissions.includes("*") || permissions.includes("inventory:approve") || permissions.includes("material:approve");
  }

  function processClosure(closure, operatorId) {
    const items = all("SELECT * FROM project_inventory_closure_items WHERE closure_id = ? ORDER BY id", [closure.id]);
    let totalQty = 0;
    let totalValue = 0;
    for (const item of items) {
      const row = get("SELECT * FROM inventory WHERE id = ?", [item.inventory_id]);
      if (!row || Number(row.project_id) !== Number(closure.equipment_instance_id) || Number(row.quantity) < Number(item.quantity)) {
        throw ApiError.validation("库存已发生变化，不能审批: " + item.inventory_id);
      }
      totalQty += Number(item.quantity);
      totalValue += Number(item.amount || 0);
      if (item.disposition === "transfer") {
        const material = get("SELECT default_location FROM materials WHERE id = ?", [item.material_id]);
        const targetLocation = material?.default_location || "主仓库-A-01";
        run("UPDATE inventory SET project_id = NULL, location = ?, last_updated = datetime('now') WHERE id = ?", [targetLocation, row.id]);
        run(`INSERT INTO material_movements
          (material_lot_id, movement_type, quantity, unit, from_location, to_location, operator_id, notes, equipment_instance_id, unit_cost, amount)
          VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.material_lot_id, item.quantity, row.unit || "件", row.location, targetLocation, operatorId,
            item.notes || "项目关闭结转到常备库存", closure.equipment_instance_id, item.unit_cost, item.amount]);
      } else if (item.disposition === "return_supplier") {
        run("UPDATE inventory SET quantity = 0, last_updated = datetime('now') WHERE id = ?", [row.id]);
        run(`INSERT INTO material_movements
          (material_lot_id, movement_type, quantity, unit, from_location, operator_id, notes, equipment_instance_id, unit_cost, amount)
          VALUES (?, 'return_supplier', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.material_lot_id, item.quantity, row.unit || "件", row.location, operatorId,
            item.notes || "项目关闭退供应商", closure.equipment_instance_id, item.unit_cost, item.amount]);
      } else {
        run("UPDATE inventory SET quantity = 0, last_updated = datetime('now') WHERE id = ?", [row.id]);
        run(`INSERT INTO material_movements
          (material_lot_id, movement_type, quantity, unit, from_location, operator_id, notes, equipment_instance_id, unit_cost, amount)
          VALUES (?, 'scrap', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.material_lot_id, item.quantity, row.unit || "件", row.location, operatorId,
            item.notes || "项目关闭报废", closure.equipment_instance_id, item.unit_cost, item.amount]);
        try {
          if (get("SELECT name FROM sqlite_master WHERE type='table' AND name='project_cost_entries'")) {
            run(`INSERT INTO project_cost_entries
              (equipment_instance_id, cost_type, source_type, source_ref, description, amount, occurred_on, status, notes, created_by)
              VALUES (?, 'quality_loss', 'project_scrap', ?, ?, ?, date('now'), 'posted', ?, ?)`,
              [closure.equipment_instance_id, String(closure.id), "项目关闭报废 " + item.material_id + " × " + item.quantity, item.amount, item.notes || null, operatorId]);
          }
        } catch (_error) { /* 旧库无成本表时忽略 */ }
      }
    }
    run("UPDATE material_lots SET project_id = NULL WHERE id IN (SELECT material_lot_id FROM project_inventory_closure_items WHERE closure_id = ?) AND NOT EXISTS (SELECT 1 FROM inventory WHERE project_id = ? AND material_lot_id = material_lots.id AND quantity > 0)", [closure.id, closure.equipment_instance_id]);
    run("UPDATE project_inventory_closures SET status='approved', approved_at=datetime('now'), processed_at=datetime('now'), total_quantity=?, total_value=? WHERE id=?", [totalQty, Math.round(totalValue * 100) / 100, closure.id]);
    run("UPDATE equipment_instances SET project_inventory_closed_at=datetime('now'), project_inventory_closed_by=? WHERE id=?", [operatorId, closure.equipment_instance_id]);
    return { id: closure.id, total_items: items.length, total_quantity: totalQty, total_value: Math.round(totalValue * 100) / 100 };
  }

  app.post("/api/project-inventory/close", wrap((req, res) => {
    const equipmentId = Number(req.body?.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    const actionMap = new Map();
    for (const action of actions) {
      const inventoryId = Number(action.inventory_id);
      const disposition = String(action.disposition || "");
      if (!inventoryId) throw ApiError.validation("actions[].inventory_id 必填");
      if (!["transfer", "return_supplier", "scrap"].includes(disposition)) throw ApiError.validation("不支持的处置方式: " + disposition);
      actionMap.set(inventoryId, { disposition, notes: action.notes || null });
    }
    const rows = all(`SELECT i.*, ml.lot_no, ml.unit_cost, m.id AS material_id, m.material_code, m.material_name,
                             m.actual_unit_price, m.estimated_unit_price
                        FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id JOIN materials m ON m.id=ml.material_id
                       WHERE i.project_id = ? AND i.quantity > 0 ORDER BY i.id`, [equipmentId]);
    const missing = rows.filter((row) => !actionMap.has(row.id));
    if (missing.length) throw ApiError.validation("还有未处理的项目库存: " + missing.map((row) => row.material_code).join("、"));
    const operatorId = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const tx = db.transaction(() => {
      const closure = run("INSERT INTO project_inventory_closures (equipment_instance_id, status, closed_by, submitted_by, submitted_at, notes) VALUES (?, 'submitted', ?, ?, datetime('now'), ?)",
        [equipmentId, operatorId, operatorId, req.body?.notes || null]);
      const closureId = Number(closure.lastInsertRowid);
      let totalValue = 0;
      for (const row of rows) {
        const action = actionMap.get(row.id);
        const unitCost = Number(row.unit_cost || row.actual_unit_price || row.estimated_unit_price || 0);
        const amount = Math.round(unitCost * Number(row.quantity) * 100) / 100;
        totalValue += amount;
        run(`INSERT INTO project_inventory_closure_items
          (closure_id, inventory_id, material_id, material_lot_id, quantity, unit_cost, amount, disposition, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [closureId, row.id, row.material_id, row.material_lot_id, row.quantity, unitCost, amount, action.disposition, action.notes]);
      }
      run("UPDATE project_inventory_closures SET total_items=?, total_quantity=?, total_value=? WHERE id=?", [rows.length, rows.reduce((sum, row) => sum + Number(row.quantity), 0), Math.round(totalValue * 100) / 100, closureId]);
      return { id: closureId, status: "submitted", total_items: rows.length, total_value: Math.round(totalValue * 100) / 100 };
    });
    res.json({ ok: true, ...tx() });
  }));

  app.post("/api/project-inventory/closures/:id/approve", wrap((req, res) => {
    if (!canApproveClosure(req)) throw ApiError.forbidden("无权审批项目库存关闭");
    const closure = get("SELECT * FROM project_inventory_closures WHERE id = ?", [Number(req.params.id)]);
    if (!closure) throw ApiError.notFound("关闭记录不存在");
    if (closure.status !== "submitted") throw ApiError.validation("只有已提交的关闭记录可以审批");
    const operatorId = (req.user && (req.user.uid || req.user.id || req.user.sub)) || null;
    const tx = db.transaction(() => {
      const result = processClosure(closure, operatorId);
      run("UPDATE project_inventory_closures SET approved_by=?, approved_at=datetime('now') WHERE id=?", [operatorId, closure.id]);
      return result;
    });
    res.json({ ok: true, status: "approved", ...tx() });
  }));

  app.post("/api/project-inventory/closures/:id/reject", wrap((req, res) => {
    if (!canApproveClosure(req)) throw ApiError.forbidden("无权驳回项目库存关闭");
    const closure = get("SELECT * FROM project_inventory_closures WHERE id = ?", [Number(req.params.id)]);
    if (!closure) throw ApiError.notFound("关闭记录不存在");
    if (closure.status !== "submitted") throw ApiError.validation("只有已提交的关闭记录可以驳回");
    run("UPDATE project_inventory_closures SET status='rejected', rejected_at=datetime('now'), rejected_by=?, reject_reason=? WHERE id=?",
      [(req.user && (req.user.uid || req.user.id || req.user.sub)) || null, req.body?.reason || null, closure.id]);
    res.json({ ok: true, status: "rejected" });
  }));

  app.get("/api/project-inventory/cost-report", wrap((req, res) => {
    const equipmentId = Number(req.query.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    const movementRows = all(`SELECT m.id AS material_id, m.material_code, m.material_name, m.unit,
                                     SUM(CASE WHEN mm.movement_type='issue' THEN mm.quantity ELSE 0 END) AS issued_qty,
                                     SUM(CASE WHEN mm.movement_type='issue' THEN mm.amount ELSE 0 END) AS issued_amount,
                                     SUM(CASE WHEN mm.movement_type='return' THEN mm.quantity ELSE 0 END) AS returned_qty,
                                     SUM(CASE WHEN mm.movement_type='return' THEN mm.amount ELSE 0 END) AS returned_amount,
                                     SUM(CASE WHEN mm.movement_type='scrap' THEN mm.quantity ELSE 0 END) AS scrap_qty,
                                     SUM(CASE WHEN mm.movement_type='scrap' THEN mm.amount ELSE 0 END) AS scrap_amount
                                FROM material_movements mm
                                JOIN material_lots ml ON ml.id = mm.material_lot_id
                                JOIN materials m ON m.id = ml.material_id
                               WHERE mm.equipment_instance_id = ?
                               GROUP BY m.id ORDER BY m.material_code`, [equipmentId]);
    const inventoryRows = all(`SELECT m.id AS material_id, m.material_code, m.material_name, m.unit,
                                     SUM(i.quantity) AS remaining_qty,
                                     SUM(i.quantity * COALESCE(NULLIF(ml.unit_cost, 0), NULLIF(m.actual_unit_price, 0), m.estimated_unit_price, 0)) AS remaining_value
                                FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id JOIN materials m ON m.id=ml.material_id
                               WHERE i.project_id = ? AND i.quantity > 0 GROUP BY m.id`, [equipmentId]);
    const map = new Map();
    for (const row of movementRows) map.set(row.material_id, { ...row });
    for (const row of inventoryRows) {
      const current = map.get(row.material_id) || { material_id: row.material_id, material_code: row.material_code, material_name: row.material_name, unit: row.unit };
      Object.assign(current, { remaining_qty: row.remaining_qty, remaining_value: row.remaining_value });
      map.set(row.material_id, current);
    }
    const items = [...map.values()].map((row) => ({
      ...row,
      issued_qty: Number(row.issued_qty || 0),
      issued_amount: Math.round(Number(row.issued_amount || 0) * 100) / 100,
      returned_qty: Number(row.returned_qty || 0),
      returned_amount: Math.round(Number(row.returned_amount || 0) * 100) / 100,
      scrap_qty: Number(row.scrap_qty || 0),
      scrap_amount: Math.round(Number(row.scrap_amount || 0) * 100) / 100,
      remaining_qty: Number(row.remaining_qty || 0),
      remaining_value: Math.round(Number(row.remaining_value || 0) * 100) / 100,
    }));
    const totalIssued = items.reduce((sum, row) => sum + row.issued_amount, 0);
    const totalReturned = items.reduce((sum, row) => sum + row.returned_amount, 0);
    const totalScrap = items.reduce((sum, row) => sum + row.scrap_amount, 0);
    const remainingValue = items.reduce((sum, row) => sum + row.remaining_value, 0);
    res.json({
      equipment_instance_id: equipmentId,
      total_issued_amount: Math.round(totalIssued * 100) / 100,
      total_returned_amount: Math.round(totalReturned * 100) / 100,
      total_scrap_amount: Math.round(totalScrap * 100) / 100,
      remaining_inventory_value: Math.round(remainingValue * 100) / 100,
      net_material_cost: Math.round((totalIssued - totalReturned + totalScrap) * 100) / 100,
      items,
    });
  }));

  app.get("/api/project-inventory/summary", wrap((req, res) => {
    const equipmentId = Number(req.query.equipment_instance_id);
    if (!equipmentId) throw ApiError.validation("equipment_instance_id 必填");
    const rows = all(`SELECT m.id AS material_id, m.material_code, m.material_name, m.unit,
                             SUM(i.quantity) AS quantity,
                             SUM(i.quantity * COALESCE(NULLIF(ml.unit_cost, 0), NULLIF(m.actual_unit_price, 0), m.estimated_unit_price, 0)) AS inventory_value
                        FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id JOIN materials m ON m.id=ml.material_id
                       WHERE i.project_id = ? AND i.quantity > 0
                       GROUP BY m.id ORDER BY inventory_value DESC`, [equipmentId]);
    res.json({
      equipment_instance_id: equipmentId,
      material_count: rows.length,
      total_quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      total_value: Math.round(rows.reduce((sum, row) => sum + Number(row.inventory_value || 0), 0) * 100) / 100,
      items: rows,
    });
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
