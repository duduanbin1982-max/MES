"use strict";

function collectShortageExceptions({ ctx, helpers, items, pushException }) {
  if (!ctx.tableExists("shortage_cases")) return;
  const rows = ctx.safeAll(`
    SELECT sc.*, m.material_code, m.material_name, wo.wo_code, wo.title AS wo_title, ei.instance_code
    FROM shortage_cases sc
    LEFT JOIN materials m ON m.id = sc.material_id
    LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
    LEFT JOIN equipment_instances ei ON ei.id = sc.equipment_instance_id
    WHERE COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
    ORDER BY
      CASE sc.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      sc.updated_at DESC
    LIMIT 200
  `);
  for (const row of rows) {
    const shortageQty = Math.round(Number(row.shortage_qty || 0) * 100) / 100;
    const hasFollowup = row.purchase_request_no || ["following", "purchasing"].includes(row.status || "");
    pushException(items, {
      id: `shortage_${row.id}`,
      type: "kit_shortage",
      severity: row.priority === "critical" ? "critical" : row.priority === "high" ? "high" : "warning",
      title: `缺料 ${row.material_code || row.material_id}`,
      message: `${row.instance_code || "-"} / ${row.wo_code || "工单"} 缺 ${row.material_name || "物料"} ${shortageQty}${row.unit || ""}，状态 ${row.status || "open"}${row.purchase_request_no ? ` / 采购申请 ${row.purchase_request_no}` : ""}${row.expected_date ? ` / ETA ${String(row.expected_date).slice(0, 10)}` : ""}${row.owner_name ? ` / 责任人 ${row.owner_name}` : ""}`,
      instance_id: row.equipment_instance_id,
      instance_code: row.instance_code,
      due_at: row.expected_date,
      created_at: row.created_at,
      source: "shortage_cases",
      source_path: hasFollowup ? helpers.purchaseFollowupPath(row.equipment_instance_id, row.purchase_request_no || null) : "/kit-closure",
      action_label: hasFollowup ? "采购跟催" : "处理缺料",
    });
  }
}

module.exports = { collectShortageExceptions };
