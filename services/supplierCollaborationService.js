"use strict";
// services/supplierCollaborationService.js
// Supplier collaboration: incoming inspection, outsourcing progress, supplier scorecard.

const { wrap } = require("../middleware/asyncHandler");
const { ApiError } = require("../app/errors");

function addColumn(db, table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incoming_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER,
      supplier_id INTEGER,
      material_id INTEGER,
      lot_no TEXT,
      inspection_no TEXT UNIQUE,
      inspection_date TEXT DEFAULT (datetime('now')),
      inspector_id INTEGER,
      sample_qty REAL DEFAULT 0,
      defect_qty REAL DEFAULT 0,
      result TEXT DEFAULT 'pending',
      defect_desc TEXT,
      disposition TEXT,
      ncr_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_incoming_supplier ON incoming_inspections(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_po ON incoming_inspections(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_result ON incoming_inspections(result);

    CREATE TABLE IF NOT EXISTS outsourcing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outsource_no TEXT UNIQUE,
      supplier_id INTEGER NOT NULL,
      equipment_instance_id INTEGER,
      work_order_id INTEGER,
      item_name TEXT NOT NULL,
      process_name TEXT,
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      progress_pct REAL DEFAULT 0,
      status TEXT DEFAULT 'planned',
      quality_status TEXT DEFAULT 'pending',
      contract_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsource_supplier ON outsourcing_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_outsource_status ON outsourcing_orders(status);

    CREATE TABLE IF NOT EXISTS supplier_score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      delivery_score REAL,
      quality_score REAL,
      service_score REAL,
      total_score REAL,
      grade TEXT,
      metrics_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(supplier_id, period)
    );
  `);
  addColumn(db, "incoming_inspections", "receiving_id", "INTEGER");
  addColumn(db, "purchase_receiving", "material_lot_id", "INTEGER");
  addColumn(db, "purchase_receiving", "inventory_id", "INTEGER");
  addColumn(db, "purchase_receiving", "inspection_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_incoming_receiving ON incoming_inspections(receiving_id)");
}

function all(db, sql, params = []) { return db.prepare(sql).all(params); }
function get(db, sql, params = []) { return db.prepare(sql).get(params); }
function run(db, sql, params = []) { return db.prepare(sql).run(params); }

function nextNo(db, table, column, prefix) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const head = `${prefix}-${today}-`;
  const row = get(db, `SELECT ${column} AS no FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`, [head + "%"]);
  let seq = 1;
  if (row?.no) {
    const n = parseInt(String(row.no).split("-").pop(), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return head + String(seq).padStart(3, "0");
}

function parseJson(text, fallback) {
  try { return JSON.parse(text || ""); } catch (_e) { return fallback; }
}

function createNcr(db, inspection, userId) {
  const ncrCode = nextNo(db, "ncr_reports", "ncr_code", "NCR");
  const material = inspection.material_id
    ? get(db, "SELECT material_code, material_name FROM materials WHERE id = ?", [inspection.material_id])
    : null;
  const partName = material ? `${material.material_code} ${material.material_name}` : (inspection.lot_no || "来料物料");
  const result = run(db, `
    INSERT INTO ncr_reports (ncr_code, source_type, source_id, equipment_instance_id, part_name, defect_desc, defect_qty, severity, created_by)
    VALUES (?, 'incoming', ?, NULL, ?, ?, ?, 'major', ?)
  `, [ncrCode, inspection.id, partName, inspection.defect_desc || "来料检验不合格", inspection.defect_qty || 1, userId || null]);
  return { id: result.lastInsertRowid, ncr_code: ncrCode };
}

function findReceiving(db, body) {
  if (body.receiving_id) return get(db, "SELECT * FROM purchase_receiving WHERE id = ?", [body.receiving_id]);
  if (body.purchase_order_id && body.lot_no) {
    return get(db, "SELECT * FROM purchase_receiving WHERE po_id = ? AND lot_no = ? ORDER BY id DESC LIMIT 1", [body.purchase_order_id, body.lot_no]);
  }
  return null;
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

function scoreSupplier(db, supplierId, period = new Date().toISOString().slice(0, 7)) {
  const supplier = get(db, "SELECT * FROM suppliers WHERE id = ?", [supplierId]);
  if (!supplier) throw ApiError.notFound("supplier not found");

  const po = get(db, `
    SELECT
      COUNT(*) AS total_po,
      SUM(CASE WHEN status IN ('received','closed') THEN 1 ELSE 0 END) AS received_po,
      SUM(CASE WHEN expected_date IS NOT NULL AND closed_at IS NOT NULL AND date(closed_at) <= date(expected_date) THEN 1 ELSE 0 END) AS on_time_po,
      SUM(CASE WHEN expected_date IS NOT NULL AND status NOT IN ('received','closed','cancelled') AND date(expected_date) < date('now') THEN 1 ELSE 0 END) AS overdue_po
    FROM purchase_orders
    WHERE supplier_id = ?
  `, [supplierId]) || {};
  const incoming = get(db, `
    SELECT
      COUNT(*) AS total_inspections,
      SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
      SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS fail_count
    FROM incoming_inspections
    WHERE supplier_id = ?
  `, [supplierId]) || {};
  const tracking = get(db, `
    SELECT
      COUNT(*) AS total_tracking,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_tracking,
      SUM(CASE WHEN delay_days > 0 THEN 1 ELSE 0 END) AS delayed_tracking
    FROM purchase_tracking
    WHERE supplier = ? OR supplier = ?
  `, [supplier.supplier_name, supplier.supplier_code]) || {};
  const outsource = get(db, `
    SELECT
      COUNT(*) AS total_outsource,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_outsource,
      SUM(CASE WHEN quality_status = 'fail' THEN 1 ELSE 0 END) AS outsource_quality_fail
    FROM outsourcing_orders
    WHERE supplier_id = ?
  `, [supplierId]) || {};

  const deliveryBase = Number(po.received_po || 0) + Number(tracking.delivered_tracking || 0);
  const deliveryGood = Number(po.on_time_po || 0) + Math.max(0, Number(tracking.delivered_tracking || 0) - Number(tracking.delayed_tracking || 0));
  const deliveryScore = deliveryBase > 0 ? Math.round((deliveryGood / deliveryBase) * 100) : 80;
  const qualityBase = Number(incoming.total_inspections || 0) + Number(outsource.total_outsource || 0);
  const qualityBad = Number(incoming.fail_count || 0) + Number(outsource.outsource_quality_fail || 0);
  const qualityScore = qualityBase > 0 ? Math.round(((qualityBase - qualityBad) / qualityBase) * 100) : 80;
  const servicePenalty = Math.min(30, Number(po.overdue_po || 0) * 10 + Math.max(0, Number(outsource.total_outsource || 0) - Number(outsource.completed_outsource || 0)) * 3);
  const serviceScore = Math.max(60, 90 - servicePenalty);
  const totalScore = Math.round(deliveryScore * 0.4 + qualityScore * 0.4 + serviceScore * 0.2);
  const grade = totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : "D";
  const metrics = { po, incoming, tracking, outsource };

  run(db, `
    INSERT INTO supplier_score_snapshots (supplier_id, period, delivery_score, quality_score, service_score, total_score, grade, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, period) DO UPDATE SET
      delivery_score=excluded.delivery_score,
      quality_score=excluded.quality_score,
      service_score=excluded.service_score,
      total_score=excluded.total_score,
      grade=excluded.grade,
      metrics_json=excluded.metrics_json,
      created_at=datetime('now')
  `, [supplierId, period, deliveryScore, qualityScore, serviceScore, totalScore, grade, JSON.stringify(metrics)]);

  return { supplier_id: supplierId, supplier_name: supplier.supplier_name, period, delivery_score: deliveryScore, quality_score: qualityScore, service_score: serviceScore, total_score: totalScore, grade, metrics };
}

function register(app, db) {
  ensureSchema(db);

  app.get("/api/supplier-collab/incoming-inspections", wrap((req, res) => {
    const { supplier_id, result } = req.query;
    const params = [];
    let sql = `
      SELECT ii.*, s.supplier_name, m.material_code, m.material_name, po.po_no, u.full_name AS inspector_name
      FROM incoming_inspections ii
      LEFT JOIN suppliers s ON ii.supplier_id = s.id
      LEFT JOIN materials m ON ii.material_id = m.id
      LEFT JOIN purchase_orders po ON ii.purchase_order_id = po.id
      LEFT JOIN users u ON ii.inspector_id = u.id
      WHERE 1=1
    `;
    if (supplier_id) { sql += " AND ii.supplier_id = ?"; params.push(supplier_id); }
    if (result) { sql += " AND ii.result = ?"; params.push(result); }
    sql += " ORDER BY ii.id DESC LIMIT 200";
    res.json(all(db, sql, params));
  }));

  app.post("/api/supplier-collab/incoming-inspections", wrap((req, res) => {
    const body = req.body || {};
    if (!body.supplier_id || !body.material_id || !body.result) {
      throw ApiError.validation("supplier_id / material_id / result 必填");
    }
    if (!["pass", "fail"].includes(body.result)) throw ApiError.validation("result 必须是 pass/fail");
    const receiving = findReceiving(db, body);
    if (body.receiving_id && !receiving) throw ApiError.notFound("收货记录不存在");
    if (receiving && Number(receiving.po_id) !== Number(body.purchase_order_id || receiving.po_id)) throw ApiError.validation("收货记录与采购单不匹配");
    const inspectionNo = body.inspection_no || nextNo(db, "incoming_inspections", "inspection_no", "IQC");
    const tx = db.transaction(() => {
      const result = run(db, `
        INSERT INTO incoming_inspections (
          purchase_order_id, supplier_id, material_id, lot_no, inspection_no, inspection_date, receiving_id,
          inspector_id, sample_qty, defect_qty, result, defect_desc, disposition, notes
        ) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        body.purchase_order_id || null, body.supplier_id, body.material_id, body.lot_no || null, inspectionNo,
        body.inspection_date || null, receiving?.id || null, body.inspector_id || req.user?.sub || req.user?.uid || null,
        Number(body.sample_qty || 0), Number(body.defect_qty || 0), body.result,
        body.defect_desc || null, body.disposition || null, body.notes || null,
      ]);
      const inspection = get(db, "SELECT * FROM incoming_inspections WHERE id = ?", [result.lastInsertRowid]);
      const release = applyIncomingInspectionResult(db, receiving, inspection.id, body.result, inspection.inspector_id);
      let ncr = null;
      if (body.result === "fail") {
        ncr = createNcr(db, inspection, body.inspector_id || req.user?.sub || req.user?.uid);
        run(db, "UPDATE incoming_inspections SET ncr_id = ?, updated_at = datetime('now') WHERE id = ?", [ncr.id, inspection.id]);
      }
      scoreSupplier(db, body.supplier_id);
      return { id: inspection.id, inspection_no: inspectionNo, receiving: release, ncr };
    });
    res.json(tx());
  }));

  app.get("/api/supplier-collab/outsourcing-orders", wrap((req, res) => {
    const { supplier_id, status } = req.query;
    const params = [];
    let sql = `
      SELECT oo.*, s.supplier_name, ei.instance_code, wo.wo_code
      FROM outsourcing_orders oo
      LEFT JOIN suppliers s ON oo.supplier_id = s.id
      LEFT JOIN equipment_instances ei ON oo.equipment_instance_id = ei.id
      LEFT JOIN work_orders wo ON oo.work_order_id = wo.id
      WHERE 1=1
    `;
    if (supplier_id) { sql += " AND oo.supplier_id = ?"; params.push(supplier_id); }
    if (status) { sql += " AND oo.status = ?"; params.push(status); }
    sql += " ORDER BY oo.id DESC LIMIT 200";
    res.json(all(db, sql, params));
  }));

  app.post("/api/supplier-collab/outsourcing-orders", wrap((req, res) => {
    const body = req.body || {};
    if (!body.supplier_id || !body.item_name) throw ApiError.validation("supplier_id / item_name 必填");
    const no = body.outsource_no || nextNo(db, "outsourcing_orders", "outsource_no", "OUT");
    const result = run(db, `
      INSERT INTO outsourcing_orders (
        outsource_no, supplier_id, equipment_instance_id, work_order_id, item_name, process_name,
        planned_start, planned_finish, progress_pct, status, quality_status, contract_amount, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      no, body.supplier_id, body.equipment_instance_id || null, body.work_order_id || null,
      body.item_name, body.process_name || null, body.planned_start || null, body.planned_finish || null,
      Number(body.progress_pct || 0), body.status || "planned", body.quality_status || "pending",
      Number(body.contract_amount || 0), body.notes || null,
    ]);
    scoreSupplier(db, body.supplier_id);
    res.json({ id: result.lastInsertRowid, outsource_no: no });
  }));

  app.put("/api/supplier-collab/outsourcing-orders/:id", wrap((req, res) => {
    const current = get(db, "SELECT * FROM outsourcing_orders WHERE id = ?", [req.params.id]);
    if (!current) throw ApiError.notFound("outsourcing order not found");
    const allowed = ["actual_start", "actual_finish", "progress_pct", "status", "quality_status", "contract_amount", "notes"];
    const sets = [];
    const params = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) { sets.push(`${field} = ?`); params.push(req.body[field]); }
    }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    run(db, `UPDATE outsourcing_orders SET ${sets.join(", ")} WHERE id = ?`, params);
    scoreSupplier(db, current.supplier_id);
    res.json({ ok: true });
  }));

  app.get("/api/supplier-collab/scorecards", wrap((req, res) => {
    const { supplier_id, period } = req.query;
    if (supplier_id) return res.json(scoreSupplier(db, supplier_id, period || new Date().toISOString().slice(0, 7)));
    const suppliers = all(db, "SELECT id FROM suppliers WHERE is_active = 1 ORDER BY supplier_code");
    res.json(suppliers.map((supplier) => scoreSupplier(db, supplier.id, period || new Date().toISOString().slice(0, 7))));
  }));

  app.get("/api/supplier-collab/overview", wrap((req, res) => {
    const incoming = get(db, "SELECT COUNT(*) AS total, SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) AS failed FROM incoming_inspections");
    const outsourcing = get(db, "SELECT COUNT(*) AS total, SUM(CASE WHEN status!='completed' THEN 1 ELSE 0 END) AS open FROM outsourcing_orders");
    const scores = all(db, "SELECT s.supplier_name, sc.* FROM supplier_score_snapshots sc JOIN suppliers s ON sc.supplier_id=s.id ORDER BY sc.total_score ASC LIMIT 5");
    res.json({ incoming, outsourcing, weakest_suppliers: scores.map((row) => ({ ...row, metrics: parseJson(row.metrics_json, {}) })) });
  }));

  console.log("[supplierCollaborationService] registered");
}

module.exports = { applyIncomingInspectionResult, ensureSchema, findReceiving, register };
