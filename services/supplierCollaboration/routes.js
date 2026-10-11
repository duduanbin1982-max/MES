"use strict";
// services/supplierCollaboration/routes.js
// HTTP 路由: 待检收货 / 来料检验 / 外协订单 / 评分卡 / 概览。
// (原 services/supplierCollaborationService.js 第 221-366 行)

const { wrap } = require("../../middleware/asyncHandler");
const { ApiError } = require("../../app/errors");
const logger = require("../../app/logger").createLogger("supplierCollaborationService");
const { all, get, run, nextNo, parseJson } = require("./_helpers");
const { ensureSchema } = require("./schema");
const { scoreSupplier } = require("./scoring");
const { createNcr, getReceivingContext, applyIncomingInspectionResult } = require("./inspection");

function register(app, db) {
  ensureSchema(db);

  app.get("/api/supplier-collab/pending-receipts", wrap((_req, res) => {
    res.json(all(db, `
      SELECT pr.id AS receiving_id, pr.po_id AS purchase_order_id, pr.received_qty,
             pr.quality_status, pr.lot_no, pr.warehouse_location, pr.received_at,
             po.po_no, po.supplier_id, po.equipment_instance_id,
             pl.material_id, pl.line_no, m.material_code, m.material_name,
             s.supplier_code, s.supplier_name
        FROM purchase_receiving pr
        JOIN purchase_orders po ON po.id = pr.po_id
        JOIN po_lines pl ON pl.id = pr.po_item_id AND pl.po_id = po.id
        JOIN materials m ON m.id = pl.material_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE pr.inspection_id IS NULL
         AND COALESCE(pr.quality_status, 'pending') = 'pending'
       ORDER BY pr.received_at, pr.id
    `));
  }));

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
    if (!body.receiving_id || !body.result) throw ApiError.validation("receiving_id / result 必填");
    if (!["pass", "fail"].includes(body.result)) throw ApiError.validation("result 必须是 pass/fail");
    const receiving = getReceivingContext(db, body.receiving_id);
    if (!receiving) throw ApiError.notFound("收货记录不存在");
    if (receiving.inspection_id || receiving.quality_status !== "pending") throw ApiError.conflict("该收货批次已经完成检验");
    if (body.purchase_order_id && Number(body.purchase_order_id) !== Number(receiving.po_id)) throw ApiError.validation("收货记录与采购单不匹配");
    if (body.supplier_id && Number(body.supplier_id) !== Number(receiving.supplier_id)) throw ApiError.validation("收货记录与供应商不匹配");
    if (body.material_id && Number(body.material_id) !== Number(receiving.material_id)) throw ApiError.validation("收货记录与物料不匹配");
    if (body.lot_no && String(body.lot_no) !== String(receiving.lot_no)) throw ApiError.validation("收货记录与批次不匹配");
    const inspectionNo = body.inspection_no || nextNo(db, "incoming_inspections", "inspection_no", "IQC");
    const tx = db.transaction(() => {
      const result = run(db, `
        INSERT INTO incoming_inspections (
          purchase_order_id, supplier_id, material_id, lot_no, inspection_no, inspection_date, receiving_id,
          inspector_id, sample_qty, defect_qty, result, defect_desc, disposition, notes
        ) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receiving.po_id, receiving.supplier_id, receiving.material_id, receiving.lot_no, inspectionNo,
        body.inspection_date || null, receiving.id, body.inspector_id || req.user?.sub || req.user?.uid || null,
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
      if (receiving.supplier_id) scoreSupplier(db, receiving.supplier_id);
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

  logger.info("[supplierCollaborationService] registered");
}

module.exports = { register };
