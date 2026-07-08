// services/purchase/followupRoutes.js
"use strict";

const { wrap } = require("../../middleware/asyncHandler");
const { isPurchaseFollowupTerminal } = require("../../app/domain/statusCatalog");
const { tableExists } = require("./trackingStore");
const {
  ensureTrackingForPo,
  syncShortageFollowUps,
  followUpSummary,
} = require("./trackingSync");
const {
  applyFollowupUpdate,
  parseIdList,
} = require("./followupEffects");

function registerPurchaseFollowupRoutes(app, db, helpers) {
  const { all, get, run } = helpers;

  app.get("/api/purchase/follow-up", wrap((req, res) => {
    const poRows = all("SELECT id FROM purchase_orders ORDER BY id DESC");
    for (const row of poRows) ensureTrackingForPo(db, get, all, run, row.id);
    syncShortageFollowUps(db, get, all, run);
    let rows = all(`SELECT pt.*, po.po_no, po.expected_date, po.total_amount,
                             COALESCE(pt.equipment_instance_id, po.equipment_instance_id) AS tracking_instance_id,
                             s.supplier_name, ei.instance_code
                      FROM purchase_tracking pt
                      LEFT JOIN purchase_orders po ON po.id = pt.purchase_order_id
                      LEFT JOIN suppliers s ON s.id = po.supplier_id
                      LEFT JOIN equipment_instances ei ON ei.id = COALESCE(pt.equipment_instance_id, po.equipment_instance_id)
                      ORDER BY COALESCE(pt.planned_delivery, po.expected_date, pt.order_date, pt.created_at) ASC, pt.id DESC`).map((row) => {
      const shortageIds = parseIdList(row.linked_shortage_ids).map((id) => Number(id)).filter(Boolean);
      const materialIds = row.source_type === "purchase_order"
        ? all("SELECT material_id FROM po_lines WHERE po_id = ?", [row.purchase_order_id]).map((item) => item.material_id).filter(Boolean)
        : (row.material_id ? [Number(row.material_id)] : []);
      const shortages = tableExists(db, "shortage_cases") && (shortageIds.length || materialIds.length)
        ? all(`SELECT sc.id, sc.work_order_id, sc.shortage_qty, sc.expected_date, sc.status, sc.purchase_request_no, sc.owner_name, wo.wo_code, m.material_code, m.material_name
               FROM shortage_cases sc
               LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
               LEFT JOIN materials m ON m.id = sc.material_id
               WHERE COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
                 AND (
                   ${shortageIds.length ? `sc.id IN (${shortageIds.map(() => "?").join(",")})` : "1=0"}
                   ${materialIds.length ? ` OR (sc.material_id IN (${materialIds.map(() => "?").join(",")}) ${row.tracking_instance_id ? "AND sc.equipment_instance_id = ?" : ""})` : ""}
                 )`,
          [
            ...shortageIds,
            ...materialIds,
            ...(materialIds.length && row.tracking_instance_id ? [row.tracking_instance_id] : []),
          ])
        : [];
      const workOrderCount = new Set(shortages.map((item) => item.work_order_id).filter(Boolean)).size;
      return {
        ...row,
        tracking_status: row.status,
        po_no: row.po_no || row.purchase_request_no || `PR-${row.id}`,
        equipment_instance_id: row.tracking_instance_id,
        source_label: row.source_type === "shortage" ? "BOM风险催办" : "采购订单",
        impact_summary: shortages.length
          ? `影响缺料 ${shortages.length} 项 / 工单 ${workOrderCount} 张`
          : "未关联缺料",
        shortages,
      };
    });
    if (req.query.include_closed !== "1") {
      rows = rows.filter((row) => !isPurchaseFollowupTerminal(row.tracking_status || row.status));
    }
    res.json({ summary: followUpSummary(rows), rows });
  }));

  app.put("/api/purchase/follow-up/:id", wrap((req, res) => {
    const row = applyFollowupUpdate(db, helpers, req.params.id, req.body || {}, req);
    res.json({ ok: true, row });
  }));
}

module.exports = {
  registerPurchaseFollowupRoutes,
};
