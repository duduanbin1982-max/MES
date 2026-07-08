"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function buildBomTree(store, parentInstanceId) {
  const { all, get } = store;
  const bomItems = all(
    `SELECT ib.*, m.material_code, m.material_name, m.spec
     FROM instance_bom ib
     LEFT JOIN materials m ON ib.material_id = m.id
     WHERE ib.equipment_instance_id = ?
     ORDER BY ib.id`,
    parentInstanceId
  );

  const nodes = [];
  for (const item of bomItems) {
    const movements = all(
      `SELECT mm.*, ml.lot_no, ml.supplier, ml.heat_no, ml.certificate_no,
              ml.quality_status, ml.received_date
       FROM material_movements mm
       JOIN material_lots ml ON mm.material_lot_id = ml.id
       WHERE mm.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)
       AND ml.material_id = ?
       ORDER BY mm.created_at DESC
       LIMIT 1`,
      [parentInstanceId, item.material_id]
    );
    const lotInfo = movements.length > 0 ? movements[0] : null;

    let qcResult = null;
    if (lotInfo && lotInfo.lot_no) {
      const lotRecordId = lotInfo.id || lotInfo.material_lot_id;
      const qc = get(
        `SELECT qc.* FROM qc_inspections qc
         JOIN material_movements mm ON qc.work_order_id = mm.work_order_id
         WHERE mm.material_lot_id = ? AND qc.material_lot_id = ?
         ORDER BY qc.inspection_date DESC LIMIT 1`,
        [lotRecordId, lotRecordId]
      );
      qcResult = qc || get(
        "SELECT * FROM qc_inspections WHERE equipment_instance_id = ? ORDER BY inspection_date DESC LIMIT 1",
        parentInstanceId
      );
    }

    const childInstance = item.child_instance_id
      ? get("SELECT * FROM equipment_instances WHERE id = ?", item.child_instance_id)
      : null;
    const node = {
      id: "node-" + item.id,
      name: item.material_name || item.bom_item_name || item.component_name || "组件",
      material_code: item.material_code || null,
      lot_no: lotInfo ? lotInfo.lot_no : null,
      supplier: lotInfo ? lotInfo.supplier : null,
      qc_result: qcResult ? qcResult.result : null,
      qc_date: qcResult ? qcResult.inspection_date : null,
      quantity: item.quantity || 1,
      children: [],
    };

    if (childInstance) {
      node.children = buildBomTree(store, childInstance.id);
    } else {
      appendWeldChildren(store, node, lotInfo);
    }
    nodes.push(node);
  }

  if (nodes.length === 0) {
    appendMaterialFallbackNodes(store, nodes, parentInstanceId);
  }
  return nodes;
}

function appendWeldChildren(store, node, lotInfo) {
  const { all } = store;
  const lotRecordId = lotInfo ? lotInfo.id || lotInfo.material_lot_id : -1;
  const workOrders = all(
    `SELECT DISTINCT wo.id, wo.wo_code, wo.title, wo.status
     FROM material_movements mm
     JOIN work_orders wo ON mm.work_order_id = wo.id
     WHERE mm.material_lot_id = ?`,
    lotRecordId
  );
  for (const workOrder of workOrders) {
    const welds = all(
      `SELECT wr.weld_no, u.full_name AS welder_name, wr.inspection_result
       FROM weld_records wr LEFT JOIN users u ON wr.welder_id = u.id
       WHERE wr.work_order_id = ? AND wr.material_lot_id = ?`,
      [workOrder.id, lotRecordId]
    );
    for (const weld of welds) {
      node.children.push({
        id: "weld-" + weld.weld_no,
        name: "焊缝 " + weld.weld_no,
        material_code: null,
        lot_no: null,
        supplier: null,
        qc_result: weld.inspection_result,
        qc_date: null,
        children: [],
      });
    }
  }
}

function appendMaterialFallbackNodes(store, nodes, parentInstanceId) {
  const materials = store.all(
    `SELECT DISTINCT ml.lot_no, ml.supplier, m.material_code, m.material_name,
            qc.result AS qc_result, qc.inspection_date AS qc_date
     FROM material_movements mm
     JOIN material_lots ml ON mm.material_lot_id = ml.id
     JOIN materials m ON ml.material_id = m.id
     LEFT JOIN qc_inspections qc ON qc.work_order_id = mm.work_order_id
     WHERE mm.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)
     ORDER BY m.material_code`,
    parentInstanceId
  );
  for (const material of materials) {
    nodes.push({
      id: "mat-" + material.lot_no,
      name: material.material_name || material.material_code || "物料",
      material_code: material.material_code,
      lot_no: material.lot_no,
      supplier: material.supplier,
      qc_result: material.qc_result,
      qc_date: material.qc_date,
      children: [],
    });
  }
}

function registerTraceTreeRoutes(app, store) {
  const { get } = store;

  app.get("/api/trace/tree/:instanceId", wrap((req, res) => {
    const instanceId = parseInt(req.params.instanceId);
    if (isNaN(instanceId)) throw ApiError.validation("Invalid instanceId");
    const equipment = get("SELECT * FROM equipment_instances WHERE id = ?", instanceId);
    if (!equipment) throw ApiError.notFound("设备实例不存在");

    res.json({
      instance_code: equipment.instance_code,
      instance_name: equipment.instance_name,
      nodes: buildBomTree(store, instanceId),
    });
  }));
}

module.exports = { buildBomTree, registerTraceTreeRoutes };
