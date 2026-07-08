// services/eco.js
// Engineering Change Order routes (P0 补 404 端点)
// MESA #4: ECO 审批通过后自动归档关联文档

"use strict";
const { ApiError } = require("../app/errors");

function register(app, db) {
  const { createEngine } = require("../app/workflow/engine");
  const wf = createEngine(db);
  const { wrap } = require("../middleware/asyncHandler");
  const all = (sql, p) => db.prepare(sql).all(p);
  const get = (sql, p) => db.prepare(sql).get(p);
  const run = (sql, p) => db.prepare(sql).run(p);


  function safeAll(sql, params = []) {
    try { return db.prepare(sql).all(params); } catch (_e) { return []; }
  }

  function safeGet(sql, params = []) {
    try { return db.prepare(sql).get(params) || null; } catch (_e) { return null; }
  }

  function impactSeverity(score) {
    if (score >= 12) return "critical";
    if (score >= 7) return "high";
    if (score >= 3) return "warning";
    return "info";
  }

  function buildImpact(eco) {
    const instanceId = Number(eco.equipment_instance_id);
    const scope = String(eco.affected_scope || "");
    const scopeLike = scope ? `%${scope}%` : null;

    const bom = safeAll(`
      SELECT id, part_number, material_id, quantity, version, category, is_key_component, unit_price
      FROM instance_bom
      WHERE equipment_instance_id = ?
        AND (? IS NULL OR part_number LIKE ? OR category LIKE ? OR notes LIKE ?)
      ORDER BY is_key_component DESC, id DESC
      LIMIT 80
    `, [instanceId, scopeLike, scopeLike, scopeLike, scopeLike]);

    const documents = safeAll(`
      SELECT id, doc_code, doc_no, title, doc_name, version, status, bom_node_id
      FROM documents
      WHERE equipment_instance_id = ?
        AND (
          eco_id = ?
          OR ? IS NULL
          OR doc_code LIKE ?
          OR doc_no LIKE ?
          OR title LIKE ?
          OR doc_name LIKE ?
        )
      ORDER BY id DESC
      LIMIT 80
    `, [instanceId, eco.id, scopeLike, scopeLike, scopeLike, scopeLike, scopeLike]);

    const bomIds = bom.map((b) => b.id);
    const bomMarks = bomIds.map(() => "?").join(",");
    const purchaseByBom = bomIds.length
      ? safeAll(`
          SELECT poi.id, po.po_no, po.status, po.expected_date, poi.bom_node_id, poi.material_id, poi.quantity, poi.received_qty
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.equipment_instance_id = ? AND poi.bom_node_id IN (${bomMarks})
          ORDER BY po.expected_date ASC
          LIMIT 100
        `, [instanceId, ...bomIds])
      : [];

    const purchaseByProject = safeAll(`
      SELECT po.id, po.po_no, po.status, po.expected_date, po.total_amount, po.supplier_id
      FROM purchase_orders po
      WHERE po.equipment_instance_id = ?
        AND po.status NOT IN ('closed', 'cancelled')
      ORDER BY po.expected_date ASC
      LIMIT 80
    `, [instanceId]);

    const workOrders = safeAll(`
      SELECT id, wo_code, title, status, planned_end, assigned_to, estimated_hours, actual_hours
      FROM work_orders
      WHERE equipment_instance_id = ?
        AND status NOT IN ('completed', 'closed', 'cancelled')
        AND (? IS NULL OR title LIKE ? OR description LIKE ?)
      ORDER BY planned_end ASC
      LIMIT 80
    `, [instanceId, scopeLike, scopeLike, scopeLike]);

    const inventory = safeAll(`
      SELECT inv.id, inv.material_lot_id, inv.quantity, inv.location, inv.status, ml.material_id, ml.lot_no, m.material_code, m.material_name
      FROM inventory inv
      JOIN material_lots ml ON ml.id = inv.material_lot_id
      JOIN materials m ON m.id = ml.material_id
      WHERE ml.material_id IN (SELECT material_id FROM instance_bom WHERE equipment_instance_id = ?)
      ORDER BY inv.quantity ASC
      LIMIT 80
    `, [instanceId]);

    const costs = safeAll(`
      SELECT id, entry_no, entry_date, description, debit_amount, credit_amount, source_type, status
      FROM erp_cost_ledger
      WHERE equipment_instance_id = ?
      ORDER BY entry_date DESC
      LIMIT 80
    `, [instanceId]);

    const quality = safeAll(`
      SELECT wq.id, wq.work_order_id, wq.qc_type, wq.result, wq.inspection_date, wq.defect_description, wo.wo_code
      FROM work_order_qc wq
      JOIN work_orders wo ON wo.id = wq.work_order_id
      WHERE wo.equipment_instance_id = ? AND (wq.result IS NULL OR wq.result NOT IN ('pass', 'passed', '合格'))
      ORDER BY wq.inspection_date DESC
      LIMIT 80
    `, [instanceId]);

    const risks = [];
    const openPo = purchaseByProject.filter((p) => !["closed", "cancelled", "received"].includes(p.status));
    const activeWo = workOrders.filter((w) => !["completed", "closed"].includes(w.status));
    const issuedDocs = documents.filter((d) => d.status === "issued");
    const keyBom = bom.filter((b) => Number(b.is_key_component) === 1);

    if (issuedDocs.length) risks.push({ type: "document", severity: "high", message: `${issuedDocs.length} 份已签发图纸可能需要升版/收回` });
    if (openPo.length) risks.push({ type: "purchase", severity: "high", message: `${openPo.length} 个未关闭采购单可能需要变更或暂停` });
    if (activeWo.length) risks.push({ type: "work_order", severity: "high", message: `${activeWo.length} 个未完工工单可能受影响` });
    if (keyBom.length) risks.push({ type: "key_component", severity: "critical", message: `${keyBom.length} 个关键件 BOM 节点受影响` });
    if (quality.length) risks.push({ type: "quality", severity: "warning", message: `${quality.length} 条未通过/待处理质量记录需复核` });

    const score = issuedDocs.length * 2 + openPo.length * 2 + activeWo.length * 2 + keyBom.length * 4 + quality.length;
    return {
      eco: {
        id: eco.id,
        eco_no: eco.eco_no,
        title: eco.title,
        status: eco.status,
        affected_scope: eco.affected_scope,
        effective_date: eco.effective_date,
        equipment_instance_id: instanceId,
      },
      summary: {
        impact_score: score,
        severity: impactSeverity(score),
        bom: bom.length,
        documents: documents.length,
        purchase_orders: purchaseByProject.length,
        purchase_items: purchaseByBom.length,
        inventory: inventory.length,
        work_orders: workOrders.length,
        quality: quality.length,
        costs: costs.length,
        risks: risks.length,
      },
      risks,
      impact: {
        bom,
        documents,
        purchase_orders: purchaseByProject,
        purchase_items: purchaseByBom,
        inventory,
        work_orders: workOrders,
        quality,
        costs,
      },
      recommendations: [
        issuedDocs.length ? "先冻结/收回受影响图纸，形成新版本后再签发" : null,
        openPo.length ? "通知采购评估未关闭采购单，必要时暂停到货或发起供应商变更" : null,
        activeWo.length ? "暂停或复核受影响工单，避免按旧图施工" : null,
        keyBom.length ? "关键件变更需补充监造、质检和追溯要求" : null,
        "审批前复核成本影响，并在成本归集里标记 ECO 来源",
      ].filter(Boolean),
    };
  }

  // MESA #4: ECO 审批通过/关闭时自动归档关联文档
  function autoArchiveDocumentsForEco(ecoId, newState) {
    if (newState === "approved" || newState === "closed") {
      const docs = db.prepare(
        "SELECT id, title, doc_code, status FROM documents WHERE eco_id = ? AND status = 'issued'"
      ).all(ecoId);
      for (const doc of docs) {
        db.prepare(
          "UPDATE documents SET status = 'revoked', revoke_reason = ?, revoked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(
          "ECO #" + ecoId + " 已审批, 文档需更新至新版本",
          doc.id
        );
        console.log(
          "[eco] ECO #" + ecoId + " approved → auto-revoked document #" + doc.id + " " + doc.title
        );
      }
      if (docs.length > 0) {
        const { emit, Events } = require("../app/ws/EventBus");
        docs.forEach((doc) =>
          emit(Events.DOCUMENT_REVOKED, {
            id: doc.id,
            doc_code: doc.doc_code,
            title: doc.title,
            reason: "ECO #" + ecoId + " 已审批, 旧版自动归档",
            eco_id: ecoId,
          })
        );
      }
    }
  }

  app.get(
    "/api/equipment_instances/:id/eco",
    wrap((req, res) => {
      res.json(
        all(
          "SELECT * FROM instance_eco WHERE equipment_instance_id = ? ORDER BY id DESC",
          req.params.id
        )
      );
    })
  );

  app.post(
    "/api/equipment_instances/:id/eco",
    wrap((req, res) => {
      const {
        eco_no,
        title,
        reason,
        affected_scope,
        effective_date,
        created_by,
      } = req.body;
      if (!eco_no || !title) throw ApiError.validation("eco_no/title 必填");
      const r = run(
        "INSERT INTO instance_eco (equipment_instance_id, eco_no, title, reason, affected_scope, effective_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          req.params.id,
          eco_no,
          title,
          reason || null,
          affected_scope || null,
          effective_date || null,
          created_by || null,
        ]
      );
      res.json({ id: r.lastInsertRowid });
    })
  );

  // P0-5: 工作流驱动的 ECO 状态迁移 + MESA #4 自动归档
  app.post(
    "/api/instance_eco/:id/transit",
    wrap((req, res) => {
      const { action, comment, effective_date, closed_date } = req.body;
      if (!action) throw ApiError.validation("action 必填");

      // 查找或创建 workflow instance
      let wfInst = db
        .prepare(
          "SELECT * FROM workflow_instances WHERE entity_type = 'eco' AND entity_id = ? ORDER BY id DESC LIMIT 1"
        )
        .get(req.params.id);
      if (!wfInst) {
        // 为旧 ECO 记录自动启动工作流
        const eco = get("SELECT * FROM instance_eco WHERE id = ?", req.params.id);
        if (!eco) throw ApiError.notFound("ECO 不存在");
        const r = wf.start("eco_change", "eco", Number(req.params.id), {
          assigned_to: req.user && req.user.sub,
          data: { eco_no: eco.eco_no, title: eco.title },
          created_by: req.user && req.user.sub,
          comment: "从 " + (eco.status || "open") + " 迁移",
        });
        wfInst = r.instance;
      }

      const extra = {};
      if (effective_date) extra.effective_date = effective_date;
      if (closed_date) extra.closed_date = closed_date;
      const result = wf.transit(
        Number(wfInst.id),
        action,
        req.user && req.user.sub,
        comment,
        extra
      );

      // 同步 status 到 eco 表
      const newState = result.instance.current_state;
      if (newState) {
        const updates = ["status = ?", "updated_at = datetime('now')"];
        const params = [newState];
        if (effective_date) {
          updates.push("effective_date = ?");
          params.push(effective_date);
        }
        if (closed_date) {
          updates.push("closed_date = ?");
          params.push(closed_date);
        }
        params.push(req.params.id);
        run(
          "UPDATE instance_eco SET " + updates.join(", ") + " WHERE id = ?",
          params
        );

        // MESA #4: ECO 审批通过 → 自动归档旧版关联文档
        autoArchiveDocumentsForEco(Number(req.params.id), newState);
      }

      res.json(result);
    })
  );


  app.get(
    "/api/instance_eco/:id/impact",
    wrap((req, res) => {
      const eco = get("SELECT * FROM instance_eco WHERE id = ?", req.params.id);
      if (!eco) throw ApiError.notFound("ECO 不存在");
      res.json(buildImpact(eco));
    })
  );

  app.put(
    "/api/instance_eco/:id",
    wrap((req, res) => {
      const { effective_date, reason, affected_scope, title } = req.body;
      const sets = [];
      const params = [];
      if (title !== undefined) {
        sets.push("title = ?");
        params.push(title);
      }
      if (effective_date !== undefined) {
        sets.push("effective_date = ?");
        params.push(effective_date);
      }
      if (reason !== undefined) {
        sets.push("reason = ?");
        params.push(reason);
      }
      if (affected_scope !== undefined) {
        sets.push("affected_scope = ?");
        params.push(affected_scope);
      }
      if (!sets.length) throw ApiError.validation("无可更新字段");
      sets.push("updated_at = datetime('now')");
      params.push(req.params.id);
      const r = run(
        "UPDATE instance_eco SET " + sets.join(", ") + " WHERE id = ?",
        params
      );
      res.json({ changes: r.changes });
    })
  );
}

module.exports = { register };
