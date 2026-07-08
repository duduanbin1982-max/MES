"use strict";

const { ApiError } = require("../../app/errors");
const { wrap } = require("../../middleware/asyncHandler");

function registerForwardTraceRoutes(app, store) {
  const { all, get } = store;

  app.get("/api/trace/forward", wrap((req, res) => {
    const { lot_no, material_code, lot_id } = req.query;
    if (!lot_no && !material_code && !lot_id) {
      throw ApiError.validation("lot_no / material_code / lot_id 至少提供一个");
    }

    let lots;
    if (lot_id) {
      lots = all("SELECT * FROM material_lots WHERE id = ?", [lot_id]);
    } else if (lot_no) {
      lots = all("SELECT * FROM material_lots WHERE lot_no = ?", lot_no);
    } else {
      lots = all("SELECT * FROM material_lots WHERE certificate_no = ? OR lot_no LIKE ?", [material_code, "%" + material_code + "%"]);
    }

    if (!lots.length) return res.json({ found: false, message: "未找到批次" });
    const result = { found: true, query: { lot_no, material_code, lot_id }, lots: [] };

    for (const lot of lots) {
      const material = get("SELECT material_code, material_name, spec FROM materials WHERE id = ?", lot.material_id);
      const lotInfo = {
        lot_id: lot.id,
        lot_no: lot.lot_no,
        material: material || {},
        supplier: lot.supplier,
        heat_no: lot.heat_no,
        certificate_no: lot.certificate_no,
        received_date: lot.received_date,
        quality_status: lot.quality_status,
      };

      const movements = all(
        `SELECT mm.*, wo.wo_code, wo.title, wo.equipment_instance_id,
                ei.instance_code, ei.instance_name
         FROM material_movements mm
         LEFT JOIN work_orders wo ON mm.work_order_id = wo.id
         LEFT JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id
         WHERE mm.material_lot_id = ? AND mm.movement_type IN ('issue', 'transfer')
         ORDER BY mm.created_at DESC`,
        lot.id
      );

      lotInfo.usage = movements.map((movement) => ({
        movement_id: movement.id,
        movement_type: movement.movement_type,
        quantity: movement.quantity,
        date: movement.created_at,
        work_order: movement.wo_code ? { id: movement.work_order_id, code: movement.wo_code, title: movement.title } : null,
        equipment: movement.instance_code ? { id: movement.equipment_instance_id, code: movement.instance_code, name: movement.instance_name } : null,
      }));

      if (movements.some((movement) => movement.work_order_id)) {
        const welds = all(
          `SELECT wr.*, u.full_name AS welder_name
           FROM weld_records wr
           LEFT JOIN users u ON wr.welder_id = u.id
           WHERE wr.material_lot_id = ?`,
          lot.id
        );
        if (welds.length) {
          lotInfo.welds = welds.map((weld) => ({
            weld_no: weld.weld_no,
            welder: weld.welder_name,
            length_mm: weld.weld_length_mm,
            procedure: weld.welding_procedure,
            inspection: weld.inspection_result,
            date: weld.inspection_date || weld.created_at,
          }));

          const ndt = all(
            `SELECT nr.*, u.full_name AS inspector_name
             FROM ndt_records nr
             LEFT JOIN users u ON nr.inspector_id = u.id
             WHERE nr.weld_record_id IN (SELECT id FROM weld_records WHERE material_lot_id = ?)`,
            lot.id
          );
          if (ndt.length) {
            lotInfo.ndt = ndt.map((record) => ({
              method: record.ndt_method,
              grade: record.ndt_grade,
              result: record.result,
              inspector: record.inspector_name,
              date: record.inspection_date,
            }));
          }
        }
      }

      result.lots.push(lotInfo);
    }

    res.json(result);
  }));
}

module.exports = { registerForwardTraceRoutes };
