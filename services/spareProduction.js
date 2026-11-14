"use strict";
// 备件生产：通用配件按库存生产（不挂项目），包含 BOM、工艺模板、领料、工序执行、质检与完工入库。
const { wrap } = require("../middleware/asyncHandler");
const { ApiError } = require("../app/errors");

function userId(req) {
  return Number((req.user && (req.user.uid || req.user.id || req.user.sub)) || 0) || null;
}
function orderNo(db) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const row = db.prepare("SELECT COUNT(*) c FROM spare_production_orders WHERE order_no LIKE ?").get(`SPO-${day}-%`);
  return `SPO-${day}-${String((row?.c || 0) + 1).padStart(3, "0")}`;
}

function register(app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spare_bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_material_id INTEGER NOT NULL,
      component_material_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      scrap_rate REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(part_material_id, component_material_id)
    );
    CREATE TABLE IF NOT EXISTS spare_route_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_material_id INTEGER NOT NULL UNIQUE,
      route_name TEXT NOT NULL DEFAULT '备件标准工艺',
      version TEXT NOT NULL DEFAULT 'A0',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS spare_route_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      operation_name TEXT NOT NULL,
      workstation_id INTEGER,
      standard_hours REAL DEFAULT 0,
      qc_required INTEGER DEFAULT 0,
      notes TEXT,
      UNIQUE(template_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS spare_production_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      part_material_id INTEGER NOT NULL,
      planned_qty REAL NOT NULL DEFAULT 1,
      produced_qty REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned',
      priority INTEGER NOT NULL DEFAULT 3,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      qc_status TEXT NOT NULL DEFAULT 'pending',
      receipt_status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS spare_production_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      operation_name TEXT NOT NULL,
      workstation_id INTEGER,
      standard_hours REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      operator_id INTEGER,
      actual_start TEXT,
      actual_end TEXT,
      qc_required INTEGER DEFAULT 0,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS spare_production_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      material_id INTEGER NOT NULL,
      required_qty REAL NOT NULL,
      issued_qty REAL DEFAULT 0,
      unit TEXT
    );
    CREATE TABLE IF NOT EXISTS spare_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL UNIQUE,
      material_id INTEGER NOT NULL,
      lot_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      location TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spare_orders_status ON spare_production_orders(status);
    CREATE INDEX IF NOT EXISTS idx_spare_orders_part ON spare_production_orders(part_material_id);
    CREATE INDEX IF NOT EXISTS idx_spare_ops_order ON spare_production_operations(order_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_spare_bom_part ON spare_bom_lines(part_material_id);
  `);

  const all = (sql, params = []) => db.prepare(sql).all(...params);
  const get = (sql, params = []) => db.prepare(sql).get(...params);
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  function partOrThrow(id) {
    const part = get("SELECT * FROM materials WHERE id = ?", [Number(id)]);
    if (!part) throw ApiError.validation("备件物料不存在");
    if (Number(part.is_self_made) !== 1) throw ApiError.validation("该物料不是自产备件（is_self_made 必须为 1）");
    return part;
  }
  function orderOrThrow(id) {
    const order = get("SELECT * FROM spare_production_orders WHERE id = ?", [Number(id)]);
    if (!order) throw ApiError.notFound("备件生产工单不存在");
    return order;
  }

  app.get("/api/spare-production/overview", wrap((_req, res) => {
    res.json({
      orders: get("SELECT COUNT(*) c FROM spare_production_orders")?.c || 0,
      in_progress: get("SELECT COUNT(*) c FROM spare_production_orders WHERE status IN ('planned','in_progress','pending_qc')")?.c || 0,
      completed: get("SELECT COUNT(*) c FROM spare_production_orders WHERE status='completed'")?.c || 0,
      pending_receipt: get("SELECT COUNT(*) c FROM spare_production_orders WHERE status='completed' AND receipt_status<>'received'")?.c || 0,
      parts: get("SELECT COUNT(*) c FROM materials WHERE is_self_made=1")?.c || 0,
    });
  }));

  app.post("/api/spare-production/parts", wrap((req, res) => {
    const body = req.body || {};
    const code = String(body.material_code || "").trim();
    const name = String(body.material_name || "").trim();
    if (!code || !name) throw ApiError.validation("material_code/material_name 必填");
    if (get("SELECT id FROM materials WHERE material_code=?", [code])) throw ApiError.conflict("物料编码已存在");
    const result = run(`INSERT INTO materials (material_code, material_name, material_type, spec, unit, is_self_made, safety_stock, reorder_point, estimated_unit_price, notes)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [code, name, body.material_type || "bought_part", body.spec || null, body.unit || "件",
        Number(body.safety_stock || 0), Number(body.reorder_point || 0), Number(body.estimated_unit_price || 0), body.notes || null]);
    res.json({ ok: true, id: result.lastInsertRowid });
  }));

  app.get("/api/spare-production/parts", wrap((_req, res) => {
    res.json(all("SELECT id, material_code, material_name, spec, unit, safety_stock, reorder_point, is_self_made FROM materials WHERE is_self_made=1 ORDER BY material_code"));
  }));

  // BOM
  app.get("/api/spare-production/boms", wrap((req, res) => {
    const partId = Number(req.query.part_material_id || 0);
    if (!partId) return res.json([]);
    res.json(all(`SELECT b.*, m.material_code, m.material_name, m.spec, m.unit AS material_unit
                    FROM spare_bom_lines b JOIN materials m ON m.id = b.component_material_id
                   WHERE b.part_material_id = ? ORDER BY b.id`, [partId]));
  }));
  app.post("/api/spare-production/boms", wrap((req, res) => {
    const { part_material_id, component_material_id, quantity, unit, scrap_rate, notes } = req.body || {};
    partOrThrow(part_material_id);
    const component = get("SELECT * FROM materials WHERE id = ?", [Number(component_material_id)]);
    if (!component) throw ApiError.validation("用料物料不存在");
    const qty = Number(quantity);
    if (!(qty > 0)) throw ApiError.validation("quantity 必须 > 0");
    run(`INSERT INTO spare_bom_lines (part_material_id, component_material_id, quantity, unit, scrap_rate, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(part_material_id, component_material_id) DO UPDATE SET quantity=excluded.quantity, unit=excluded.unit, scrap_rate=excluded.scrap_rate, notes=excluded.notes`,
      [Number(part_material_id), Number(component_material_id), qty, unit || component.unit, Number(scrap_rate || 0), notes || null]);
    res.json({ ok: true });
  }));
  app.delete("/api/spare-production/boms/:id", wrap((req, res) => {
    run("DELETE FROM spare_bom_lines WHERE id=?", [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // 工艺模板
  app.get("/api/spare-production/routes", wrap((req, res) => {
    const partId = Number(req.query.part_material_id || 0);
    if (!partId) return res.json({ template: null, steps: [] });
    const template = get("SELECT * FROM spare_route_templates WHERE part_material_id=?", [partId]);
    res.json({ template, steps: template ? all("SELECT s.*, w.name AS workstation_name FROM spare_route_steps s LEFT JOIN workstations w ON w.id=s.workstation_id WHERE s.template_id=? ORDER BY s.sequence", [template.id]) : [] });
  }));
  app.post("/api/spare-production/routes", wrap((req, res) => {
    const { part_material_id, operation_name, sequence, workstation_id, standard_hours, qc_required, notes } = req.body || {};
    partOrThrow(part_material_id);
    if (!operation_name) throw ApiError.validation("operation_name 必填");
    const seq = Number(sequence || 10);
    if (!(seq > 0)) throw ApiError.validation("sequence 必须 > 0");
    let template = get("SELECT * FROM spare_route_templates WHERE part_material_id=?", [Number(part_material_id)]);
    if (!template) {
      const r = run("INSERT INTO spare_route_templates (part_material_id) VALUES (?)", [Number(part_material_id)]);
      template = { id: r.lastInsertRowid };
    }
    run(`INSERT INTO spare_route_steps (template_id, sequence, operation_name, workstation_id, standard_hours, qc_required, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(template_id, sequence) DO UPDATE SET operation_name=excluded.operation_name, workstation_id=excluded.workstation_id, standard_hours=excluded.standard_hours, qc_required=excluded.qc_required, notes=excluded.notes`,
      [template.id, seq, String(operation_name).trim(), workstation_id || null, Number(standard_hours || 0), qc_required ? 1 : 0, notes || null]);
    run("UPDATE spare_route_templates SET updated_at=datetime('now') WHERE id=?", [template.id]);
    res.json({ ok: true, template_id: template.id });
  }));
  app.delete("/api/spare-production/routes/:id", wrap((req, res) => {
    run("DELETE FROM spare_route_steps WHERE id=?", [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // 工单
  app.get("/api/spare-production/orders", wrap((req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const params = [];
    let sql = `SELECT o.*, m.material_code, m.material_name, m.unit AS material_unit
                 FROM spare_production_orders o JOIN materials m ON m.id=o.part_material_id`;
    if (status) { sql += " WHERE o.status=?"; params.push(status); }
    sql += " ORDER BY o.id DESC";
    res.json(all(sql, params));
  }));
  app.post("/api/spare-production/orders", wrap((req, res) => {
    const { part_material_id, planned_qty, planned_start, planned_end, priority, notes } = req.body || {};
    const part = partOrThrow(part_material_id);
    const qty = Number(planned_qty);
    if (!(qty > 0)) throw ApiError.validation("planned_qty 必须 > 0");
    const template = get("SELECT * FROM spare_route_templates WHERE part_material_id=?", [part.id]);
    if (!template) throw ApiError.validation("该备件还没有工艺模板，请先维护工艺");
    const steps = all("SELECT * FROM spare_route_steps WHERE template_id=? ORDER BY sequence", [template.id]);
    if (!steps.length) throw ApiError.validation("工艺模板没有工序");
    const tx = db.transaction(() => {
      const no = orderNo(db);
      const result = run(`INSERT INTO spare_production_orders
        (order_no, part_material_id, planned_qty, status, priority, planned_start, planned_end, notes, created_by)
        VALUES (?, ?, ?, 'planned', ?, ?, ?, ?, ?)`,
        [no, part.id, qty, Number(priority || 3), planned_start || null, planned_end || null, notes || null, userId(req)]);
      const orderId = result.lastInsertRowid;
      for (const step of steps) {
        run(`INSERT INTO spare_production_operations (order_id, sequence, operation_name, workstation_id, standard_hours, qc_required, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, step.sequence, step.operation_name, step.workstation_id || null, step.standard_hours || 0, step.qc_required ? 1 : 0, step.notes || null]);
      }
      const bom = all("SELECT * FROM spare_bom_lines WHERE part_material_id=?", [part.id]);
      for (const line of bom) {
        run("INSERT INTO spare_production_materials (order_id, material_id, required_qty, unit) VALUES (?, ?, ?, ?)",
          [orderId, line.component_material_id, Number(line.quantity) * qty, line.unit || null]);
      }
      return { id: orderId, order_no: no };
    });
    res.json({ ok: true, ...tx() });
  }));
  app.get("/api/spare-production/orders/:id", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    const part = get("SELECT * FROM materials WHERE id=?", [order.part_material_id]);
    res.json({
      ...order,
      part,
      operations: all("SELECT o.*, w.name AS workstation_name FROM spare_production_operations o LEFT JOIN workstations w ON w.id=o.workstation_id WHERE o.order_id=? ORDER BY o.sequence", [order.id]),
      materials: all("SELECT sm.*, m.material_code, m.material_name FROM spare_production_materials sm JOIN materials m ON m.id=sm.material_id WHERE sm.order_id=? ORDER BY sm.id", [order.id]),
      receipt: get("SELECT * FROM spare_receipts WHERE order_id=?", [order.id]) || null,
    });
  }));

  app.post("/api/spare-production/orders/:id/issue", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    if (["completed", "cancelled"].includes(order.status)) throw ApiError.validation("已完成/取消工单不能领料");
    const requirements = all("SELECT * FROM spare_production_materials WHERE order_id=? AND issued_qty < required_qty", [order.id]);
    const tx = db.transaction(() => {
      for (const reqLine of requirements) {
        let need = Number(reqLine.required_qty) - Number(reqLine.issued_qty || 0);
        if (!(need > 0)) continue;
        const lots = all(`SELECT i.id AS inventory_id, i.location, i.quantity, ml.id AS lot_id, ml.lot_no, ml.unit
                            FROM inventory i JOIN material_lots ml ON ml.id=i.material_lot_id
                           WHERE ml.material_id=? AND i.quantity > 0
                           ORDER BY ml.id, i.id`, [reqLine.material_id]);
        const available = lots.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        if (available < need) throw ApiError.validation(`物料不足：${reqLine.material_id} 需要 ${need}，可用 ${available}`);
        for (const lot of lots) {
          if (need <= 0) break;
          const take = Math.min(need, Number(lot.quantity));
          run("UPDATE inventory SET quantity=quantity-?, last_updated=datetime('now') WHERE id=?", [take, lot.inventory_id]);
          run(`INSERT INTO material_movements (material_lot_id, movement_type, quantity, unit, from_location, notes)
               VALUES (?, 'issue', ?, ?, ?, ?)`,
            [lot.lot_id, take, lot.unit || reqLine.unit || "件", lot.location || null, `备件生产工单 ${order.order_no}`]);
          need -= take;
        }
        run("UPDATE spare_production_materials SET issued_qty=required_qty WHERE id=?", [reqLine.id]);
      }
    });
    tx();
    res.json({ ok: true });
  }));

  function startOperation(order, operation, operatorId) {
    if (operation.status !== "pending") throw ApiError.validation("工序不是待开始状态");
    const prev = get("SELECT * FROM spare_production_operations WHERE order_id=? AND sequence<? AND status<>'completed' ORDER BY sequence LIMIT 1", [order.id, operation.sequence]);
    if (prev) throw ApiError.validation(`上一道工序未完成：${prev.operation_name}`);
    const short = get("SELECT sm.*, m.material_name FROM spare_production_materials sm JOIN materials m ON m.id=sm.material_id WHERE sm.order_id=? AND sm.issued_qty < sm.required_qty LIMIT 1", [order.id]);
    if (short) throw ApiError.validation(`请先领料：${short.material_name} 还差 ${Number(short.required_qty) - Number(short.issued_qty)}`);
    const tx = db.transaction(() => {
      run("UPDATE spare_production_operations SET status='in_progress', operator_id=?, actual_start=datetime('now') WHERE id=?", [operatorId || null, operation.id]);
      run("UPDATE spare_production_orders SET status='in_progress', actual_start=COALESCE(actual_start, datetime('now')), updated_at=datetime('now') WHERE id=?", [order.id]);
    });
    tx();
  }
  function completeOperation(order, operation) {
    if (operation.status !== "in_progress") throw ApiError.validation("工序不是进行中状态");
    const tx = db.transaction(() => {
      run("UPDATE spare_production_operations SET status='completed', actual_end=datetime('now') WHERE id=?", [operation.id]);
      const pending = get("SELECT COUNT(*) c FROM spare_production_operations WHERE order_id=? AND status<>'completed'", [order.id]);
      if (Number(pending.c) === 0) {
        run("UPDATE spare_production_orders SET status='pending_qc', qc_status='pending', updated_at=datetime('now') WHERE id=?", [order.id]);
      }
    });
    tx();
  }

  app.post("/api/spare-production/orders/:id/operations/:operationId/start", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    const operation = get("SELECT * FROM spare_production_operations WHERE id=? AND order_id=?", [Number(req.params.operationId), order.id]);
    if (!operation) throw ApiError.notFound("工序不存在");
    startOperation(order, operation, userId(req));
    res.json({ ok: true });
  }));
  app.post("/api/spare-production/orders/:id/operations/:operationId/complete", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    const operation = get("SELECT * FROM spare_production_operations WHERE id=? AND order_id=?", [Number(req.params.operationId), order.id]);
    if (!operation) throw ApiError.notFound("工序不存在");
    completeOperation(order, operation);
    res.json({ ok: true });
  }));

  function autoReceive(order) {
    if (order.receipt_status === "received") return get("SELECT * FROM spare_receipts WHERE order_id=?", [order.id]);
    const part = get("SELECT * FROM materials WHERE id=?", [order.part_material_id]);
    const existingLot = get("SELECT * FROM material_lots WHERE lot_no=?", [`SPO-${order.order_no}`]);
    if (existingLot) throw ApiError.conflict("完工批次已存在，可能已入库");
    const qty = Number(order.planned_qty);
    const receiptNo = `SR-${order.order_no}`;
    const location = "备件成品库";
    const tx = db.transaction(() => {
      const lot = run("INSERT INTO material_lots (material_id, lot_no, received_date, quantity, unit, quality_status, notes) VALUES (?, ?, datetime('now'), ?, ?, 'passed', ?)",
        [part.id, `SPO-${order.order_no}`, qty, part.unit || "件", `备件生产完工入库 ${order.order_no}`]);
      const lotId = lot.lastInsertRowid;
      run("INSERT INTO inventory (material_lot_id, location, quantity, unit, status) VALUES (?, ?, ?, ?, 'available')",
        [lotId, location, qty, part.unit || "件"]);
      run("INSERT INTO spare_receipts (receipt_no, order_id, material_id, lot_id, quantity, unit, location, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [receiptNo, order.id, part.id, lotId, qty, part.unit || "件", location, null]);
      run("UPDATE spare_production_orders SET status='completed', produced_qty=?, actual_end=COALESCE(actual_end, datetime('now')), receipt_status='received', updated_at=datetime('now') WHERE id=?", [qty, order.id]);
      return { receipt_no: receiptNo, lot_id: lotId, quantity: qty, location };
    });
    return tx();
  }

  app.post("/api/spare-production/orders/:id/qc", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    if (order.status !== "pending_qc") throw ApiError.validation("工单不在待质检状态");
    const result = String(req.body?.result || "");
    if (!["pass", "fail"].includes(result)) throw ApiError.validation("result 必须是 pass/fail");
    if (result === "fail") {
      run("UPDATE spare_production_orders SET qc_status='failed', status='in_progress', updated_at=datetime('now') WHERE id=?", [order.id]);
      return res.json({ ok: true, status: "in_progress", qc_status: "failed" });
    }
    run("UPDATE spare_production_orders SET qc_status='passed', updated_at=datetime('now') WHERE id=?", [order.id]);
    const receipt = autoReceive(get("SELECT * FROM spare_production_orders WHERE id=?", [order.id]));
    res.json({ ok: true, status: "completed", qc_status: "passed", receipt });
  }));

  app.post("/api/spare-production/orders/:id/receipt", wrap((req, res) => {
    const order = orderOrThrow(req.params.id);
    if (order.qc_status !== "passed") throw ApiError.validation("质检通过后才能入库");
    res.json({ ok: true, receipt: autoReceive(order) });
  }));

  app.get("/api/spare-production/receipts", wrap((_req, res) => {
    res.json(all(`SELECT r.*, m.material_code, m.material_name, ml.lot_no, o.order_no
                    FROM spare_receipts r JOIN materials m ON m.id=r.material_id
                    LEFT JOIN material_lots ml ON ml.id=r.lot_id
                    LEFT JOIN spare_production_orders o ON o.id=r.order_id
                   ORDER BY r.id DESC LIMIT 200`));
  }));
}

module.exports = { register };
