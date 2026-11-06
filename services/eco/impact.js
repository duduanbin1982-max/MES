"use strict";

function impactSeverity(score) {
  if (score >= 12) return "critical";
  if (score >= 7) return "high";
  if (score >= 3) return "warning";
  return "info";
}

function createImpactAnalyzer(db) {
  const safeAll = (sql, params = []) => {
    try { return db.prepare(sql).all(params); } catch (_error) { return []; }
  };

  return function buildImpact(eco) {
    const instanceId = Number(eco.equipment_instance_id);
    const scope = String(eco.affected_scope || "");
    const scopeLike = scope ? `%${scope}%` : null;
    // 2026-11-07（ECO 审计）：BOM 关联条件增加 eco_id，让已挂到本 ECO 的 BOM 变更行
    // 即使不匹配 affected_scope 关键字也会进入影响分析。
    const bom = safeAll(`
      SELECT id, part_number, material_id, quantity, version, category, is_key_component, unit_price
      FROM instance_bom
      WHERE equipment_instance_id = ?
        AND (eco_id = ? OR ? IS NULL OR part_number LIKE ? OR category LIKE ? OR notes LIKE ?)
      ORDER BY is_key_component DESC, id DESC
      LIMIT 80
    `, [instanceId, eco.id, scopeLike, scopeLike, scopeLike, scopeLike]);
    const documents = safeAll(`
      SELECT id, doc_code, doc_no, title, doc_name, version, status, bom_node_id
      FROM documents
      WHERE equipment_instance_id = ?
        AND (eco_id = ? OR ? IS NULL OR doc_code LIKE ? OR doc_no LIKE ? OR title LIKE ? OR doc_name LIKE ?)
      ORDER BY id DESC
      LIMIT 80
    `, [instanceId, eco.id, scopeLike, scopeLike, scopeLike, scopeLike, scopeLike]);
    const bomIds = bom.map((item) => item.id);
    const purchaseItems = bomIds.length ? safeAll(`
      SELECT poi.id, po.po_no, po.status, po.expected_date, poi.bom_node_id, poi.material_id, poi.quantity, poi.received_qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      WHERE po.equipment_instance_id = ? AND poi.bom_node_id IN (${bomIds.map(() => "?").join(",")})
      ORDER BY po.expected_date ASC
      LIMIT 100
    `, [instanceId, ...bomIds]) : [];
    const purchaseOrders = safeAll(`
      SELECT po.id, po.po_no, po.status, po.expected_date, po.total_amount, po.supplier_id
      FROM purchase_orders po
      WHERE po.equipment_instance_id = ? AND po.status NOT IN ('closed', 'cancelled')
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

    const openPurchaseOrders = purchaseOrders.filter((item) => !["closed", "cancelled", "received"].includes(item.status));
    const activeWorkOrders = workOrders.filter((item) => !["completed", "closed"].includes(item.status));
    const issuedDocuments = documents.filter((item) => item.status === "issued");
    const keyComponents = bom.filter((item) => Number(item.is_key_component) === 1);
    const risks = [];
    if (issuedDocuments.length) risks.push({ type: "document", severity: "high", message: `${issuedDocuments.length} 份已签发图纸可能需要升版/收回` });
    if (openPurchaseOrders.length) risks.push({ type: "purchase", severity: "high", message: `${openPurchaseOrders.length} 个未关闭采购单可能需要变更或暂停` });
    if (activeWorkOrders.length) risks.push({ type: "work_order", severity: "high", message: `${activeWorkOrders.length} 个未完工工单可能受影响` });
    if (keyComponents.length) risks.push({ type: "key_component", severity: "critical", message: `${keyComponents.length} 个关键件 BOM 节点受影响` });
    if (quality.length) risks.push({ type: "quality", severity: "warning", message: `${quality.length} 条未通过/待处理质量记录需复核` });
    if (!bom.length) risks.push({ type: "bom", severity: "info", message: `未找到匹配 affected_scope 的 BOM 节点（scope: ${scope || "全部"}）` });
    const score = issuedDocuments.length * 2 + openPurchaseOrders.length * 2 + activeWorkOrders.length * 2 + keyComponents.length * 4 + quality.length;

    return {
      eco: {
        id: eco.id, eco_no: eco.eco_no, title: eco.title, status: eco.status,
        affected_scope: eco.affected_scope, effective_date: eco.effective_date,
        equipment_instance_id: instanceId,
      },
      summary: {
        impact_score: score, severity: impactSeverity(score), bom: bom.length, documents: documents.length,
        purchase_orders: purchaseOrders.length, purchase_items: purchaseItems.length, inventory: inventory.length,
        work_orders: workOrders.length, quality: quality.length, costs: costs.length, risks: risks.length,
      },
      risks,
      impact: { bom, documents, purchase_orders: purchaseOrders, purchase_items: purchaseItems, inventory, work_orders: workOrders, quality, costs },
      recommendations: [
        issuedDocuments.length ? "先冻结/收回受影响图纸，形成新版本后再签发" : null,
        openPurchaseOrders.length ? "通知采购评估未关闭采购单，必要时暂停到货或发起供应商变更" : null,
        activeWorkOrders.length ? "暂停或复核受影响工单，避免按旧图施工" : null,
        keyComponents.length ? "关键件变更需补充监造、质检和追溯要求" : null,
        !bom.length ? "受影响范围未命中 BOM：请缩小/核对 affected_scope（图号、分类或备注关键字）" : null,
        "审批前复核成本影响，并在成本归集里标记 ECO 来源",
      ].filter(Boolean),
    };
  };
}

module.exports = { createImpactAnalyzer, impactSeverity };
