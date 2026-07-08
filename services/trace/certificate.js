"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerCertificateRoutes(app, store) {
  const { all, get } = store;

  app.get("/api/trace/certificate/:instanceId", wrap((req, res) => {
    const instanceId = parseInt(req.params.instanceId);
    if (isNaN(instanceId)) throw ApiError.validation("Invalid instanceId");
    const equipment = get("SELECT * FROM equipment_instances WHERE id = ?", instanceId);
    if (!equipment) throw ApiError.notFound("设备实例不存在");

    const materials = all(
      `SELECT DISTINCT ml.lot_no, ml.supplier, ml.heat_no, ml.certificate_no,
              ml.quality_status, ml.received_date,
              m.material_code, m.material_name, m.spec
       FROM material_movements mm
       JOIN material_lots ml ON mm.material_lot_id = ml.id
       JOIN materials m ON ml.material_id = m.id
       WHERE mm.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)
       ORDER BY m.material_code`,
      instanceId
    );
    const inspections = all(
      `SELECT qc.*, u.full_name AS inspector_name
       FROM qc_inspections qc
       LEFT JOIN users u ON qc.inspector_id = u.id
       WHERE qc.equipment_instance_id = ?
       ORDER BY qc.inspection_date DESC`,
      instanceId
    );
    const weldNdts = all(
      `SELECT wr.weld_no, wr.welding_procedure, wr.inspection_result AS weld_result,
              u1.full_name AS welder_name,
              nr.ndt_method, nr.ndt_grade, nr.result AS ndt_result,
              u2.full_name AS ndt_inspector
       FROM weld_records wr
       LEFT JOIN users u1 ON wr.welder_id = u1.id
       LEFT JOIN ndt_records nr ON nr.weld_record_id = wr.id
       LEFT JOIN users u2 ON nr.inspector_id = u2.id
       WHERE wr.work_order_id IN (SELECT id FROM work_orders WHERE equipment_instance_id = ?)
       ORDER BY wr.weld_no`,
      instanceId
    );
    const operators = all(
      `SELECT DISTINCT u.id, u.full_name, u.username
       FROM work_order_operations wop
       JOIN work_orders wo ON wop.work_order_id = wo.id
       JOIN users u ON wop.operator_id = u.id
       WHERE wo.equipment_instance_id = ?`,
      instanceId
    );

    res.json({
      certificate_id: "CERT-" + equipment.instance_code + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      generated_at: new Date().toISOString(),
      equipment: {
        code: equipment.instance_code,
        name: equipment.instance_name,
        customer: equipment.customer_name,
        model: equipment.model_code || null,
        status: equipment.status,
      },
      materials: materials.map((material) => ({
        material_code: material.material_code,
        material_name: material.material_name,
        spec: material.spec,
        lot_no: material.lot_no,
        supplier: material.supplier,
        heat_no: material.heat_no,
        certificate_no: material.certificate_no,
        quality_status: material.quality_status,
        received_date: material.received_date,
      })),
      inspections: inspections.map((inspection) => ({
        type: inspection.qc_type || inspection.inspection_type,
        result: inspection.result,
        inspector: inspection.inspector_name,
        date: inspection.inspection_date,
        notes: inspection.notes || null,
      })),
      welds: weldNdts.map((weld) => ({
        weld_no: weld.weld_no,
        procedure: weld.welding_procedure,
        welder: weld.welder_name,
        weld_result: weld.weld_result,
        ndt_method: weld.ndt_method,
        ndt_grade: weld.ndt_grade,
        ndt_result: weld.ndt_result,
        ndt_inspector: weld.ndt_inspector,
      })),
      operators: operators.map((operator) => ({
        id: operator.id,
        name: operator.full_name,
        username: operator.username,
      })),
      qc_summary: buildQcSummary(inspections),
    });
  }));
}

function buildQcSummary(inspections) {
  const summary = {
    total: inspections.length,
    pass: inspections.filter((inspection) => inspection.result === "pass" || inspection.result === "合格").length,
    fail: inspections.filter((inspection) => inspection.result === "fail" || inspection.result === "不合格").length,
    by_type: {},
  };
  for (const inspection of inspections) {
    const type = inspection.qc_type || inspection.inspection_type || "general";
    if (!summary.by_type[type]) summary.by_type[type] = { total: 0, pass: 0, fail: 0 };
    summary.by_type[type].total += 1;
    if (inspection.result === "pass" || inspection.result === "合格") summary.by_type[type].pass += 1;
    else if (inspection.result === "fail" || inspection.result === "不合格") summary.by_type[type].fail += 1;
  }
  return summary;
}

module.exports = { buildQcSummary, registerCertificateRoutes };
