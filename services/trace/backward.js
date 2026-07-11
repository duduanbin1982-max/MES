"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerBackwardTraceRoutes(app, store) {
  const { all, get } = store;

  app.get("/api/trace/backward", wrap((req, res) => {
    const { instance_id, instance_code } = req.query;
    if (!instance_id && !instance_code) throw ApiError.validation("instance_id 或 instance_code 必填");

    const equipment = instance_id
      ? get("SELECT * FROM equipment_instances WHERE id = ?", instance_id)
      : get("SELECT * FROM equipment_instances WHERE instance_code = ?", instance_code);
    if (!equipment) throw ApiError.notFound("设备实例不存在");

    const result = {
      equipment: {
        id: equipment.id,
        code: equipment.instance_code,
        name: equipment.instance_name,
        customer: equipment.customer_name,
        status: equipment.status,
      },
      work_orders: [],
    };

    const workOrders = all("SELECT * FROM work_orders WHERE equipment_instance_id = ? ORDER BY id", equipment.id);
    for (const workOrder of workOrders) {
      const workOrderInfo = { id: workOrder.id, code: workOrder.wo_code, title: workOrder.title, status: workOrder.status };
      const operations = all(
        `SELECT wop.*, u.full_name AS operator_name
         FROM work_order_operations wop LEFT JOIN users u ON wop.operator_id = u.id
         WHERE wop.work_order_id = ? ORDER BY wop.timestamp`,
        workOrder.id
      );
      workOrderInfo.operations = operations.map((operation) => ({
        action: operation.action,
        operator: operation.operator_name,
        hours: operation.hours_worked,
        time: operation.timestamp,
      }));

      const movements = all(
        `SELECT mm.*, ml.lot_no, ml.supplier, ml.heat_no, ml.certificate_no,
                m.material_code, m.material_name
         FROM material_movements mm
         JOIN material_lots ml ON mm.material_lot_id = ml.id
         JOIN materials m ON ml.material_id = m.id
         WHERE mm.work_order_id = ? ORDER BY mm.created_at`,
        workOrder.id
      );
      workOrderInfo.materials = movements.map((movement) => ({
        lot_no: movement.lot_no,
        material_code: movement.material_code,
        material_name: movement.material_name,
        movement_type: movement.movement_type,
        quantity: movement.quantity,
        supplier: movement.supplier,
        heat_no: movement.heat_no,
        certificate_no: movement.certificate_no,
      }));

      const welds = all(
        `SELECT wr.*, u.full_name AS welder_name
         FROM weld_records wr LEFT JOIN users u ON wr.welder_id = u.id
         WHERE wr.work_order_id = ?`,
        workOrder.id
      );
      if (welds.length) {
        workOrderInfo.welds = welds.map((weld) => ({ weld_no: weld.weld_no, welder: weld.welder_name, result: weld.inspection_result }));
      }

      const assemblies = all(`SELECT ar.*, u.full_name AS operator_name
        FROM assembly_records ar LEFT JOIN users u ON u.id=ar.operator_id
        WHERE ar.work_order_id=? ORDER BY ar.step_no, ar.id`, workOrder.id);
      if (assemblies.length) workOrderInfo.assemblies = assemblies;

      const ndt = all(`SELECT nr.*, wr.weld_no, u.full_name AS inspector_name
        FROM ndt_records nr
        LEFT JOIN weld_records wr ON wr.id=nr.weld_record_id
        LEFT JOIN users u ON u.id=nr.inspector_id
        WHERE nr.work_order_id=? ORDER BY nr.inspection_date, nr.id`, workOrder.id);
      if (ndt.length) workOrderInfo.ndt = ndt;

      const qcRows = all("SELECT * FROM qc_inspections WHERE work_order_id = ?", workOrder.id);
      if (qcRows.length) {
        workOrderInfo.qc = qcRows.map((qc) => ({
          type: qc.qc_type || qc.inspection_type,
          result: qc.result,
          inspector_id: qc.inspector_id,
          date: qc.inspection_date,
        }));
      }

      result.work_orders.push(workOrderInfo);
    }

    res.json(result);
  }));

  app.get("/api/trace/matrix", wrap((req, res) => {
    const { instance_id } = req.query;
    if (!instance_id) throw ApiError.validation("instance_id 必填");
    const equipment = get("SELECT * FROM equipment_instances WHERE id = ?", instance_id);
    if (!equipment) throw ApiError.notFound("设备实例不存在");

    const rows = all(
      `SELECT ml.lot_no, ml.supplier, ml.heat_no, m.material_code, m.material_name,
              wo.wo_code, wo.title AS wo_title,
              wr.weld_no, u.full_name AS welder_name, wr.inspection_result AS weld_result,
              nr.ndt_method, nr.ndt_grade, nr.result AS ndt_result,
              qc.result AS qc_result, qc.inspection_date AS qc_date
       FROM material_movements mm
       JOIN material_lots ml ON mm.material_lot_id = ml.id
       JOIN materials m ON ml.material_id = m.id
       LEFT JOIN work_orders wo ON mm.work_order_id = wo.id
       LEFT JOIN weld_records wr ON wr.work_order_id = wo.id AND wr.material_lot_id = ml.id
       LEFT JOIN users u ON wr.welder_id = u.id
       LEFT JOIN ndt_records nr ON nr.weld_record_id = wr.id
       LEFT JOIN qc_inspections qc ON qc.work_order_id = wo.id
       WHERE wo.equipment_instance_id = ?
       ORDER BY m.material_code, ml.lot_no, wo.wo_code`,
      instance_id
    );

    res.json({ equipment: { id: equipment.id, code: equipment.instance_code }, matrix: rows, count: rows.length });
  }));
}

module.exports = { registerBackwardTraceRoutes };
