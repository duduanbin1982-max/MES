"use strict";

function createPurchaseFollowupReader(ctx) {
  const { tableExists, safeAll } = ctx;

  function purchaseFollowupPath(instanceId, purchaseRequestNo = null) {
    const params = [];
    if (instanceId) params.push(`instance_id=${encodeURIComponent(instanceId)}`);
    if (purchaseRequestNo) params.push(`purchase_request_no=${encodeURIComponent(purchaseRequestNo)}`);
    return `/purchase?tab=followup${params.length ? `&${params.join("&")}` : ""}`;
  }

  function normalizeTrackingStatus(status, purchaseRequestNo = null) {
    if (status === "closed" || status === "arrived" || status === "received") return "delivered";
    if (status === "cancelled") return "cancelled";
    if (["following", "assigned", "purchasing", "in_transit", "submitted", "confirmed", "partially_received"].includes(status)) return "following";
    return purchaseRequestNo ? "following" : "pending";
  }

  function hasText(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function enrichPurchaseFollowup(row) {
    const trackingStatus = row.tracking_status || normalizeTrackingStatus(row.status, row.purchase_request_no || null);
    const hasOwner = hasText(row.owner_name);
    const hasEta = hasText(row.planned_delivery);
    const isOverdue = Number(row.delay_days || 0) > 0 && !["delivered", "cancelled"].includes(trackingStatus);
    const blockingReason = trackingStatus === "pending"
      ? "待启动"
      : !hasOwner
        ? "缺责任人"
        : !hasEta
          ? "缺ETA"
          : isOverdue
            ? "已逾期"
            : null;
    return {
      ...row,
      tracking_status: trackingStatus,
      has_owner: hasOwner,
      has_eta: hasEta,
      is_overdue: isOverdue,
      blocking_reason: blockingReason,
      is_blocking: Boolean(blockingReason),
      is_controlled: !blockingReason,
    };
  }

  function purchaseFollowupsForInstance(instanceId) {
    const rows = [];
    const seen = new Set();

    if (tableExists("purchase_tracking")) {
      const trackingRows = safeAll(`
        SELECT *
        FROM purchase_tracking
        WHERE equipment_instance_id = ?
          AND COALESCE(status, '') NOT IN ('delivered', 'cancelled')
        ORDER BY COALESCE(planned_delivery, updated_at, created_at) ASC, id DESC
      `, [instanceId]);
      for (const row of trackingRows) {
        const key = `${row.source_type || "purchase_order"}:${row.source_ref_id || row.purchase_order_id || row.id}`;
        seen.add(key);
        rows.push({
          id: row.id,
          source_type: row.source_type || "purchase_order",
          source_ref_id: row.source_ref_id || row.purchase_order_id || row.id,
          po_no: row.purchase_request_no || row.po_no || null,
          purchase_request_no: row.purchase_request_no || null,
          planned_delivery: row.planned_delivery || null,
          actual_delivery: row.actual_delivery || null,
          delay_days: Number(row.delay_days || 0),
          tracking_status: normalizeTrackingStatus(row.status, row.purchase_request_no || null),
          urgent_tags: row.urgent_tags || null,
          owner_name: row.owner_name || null,
          remarks: row.remarks || null,
          risk_level: row.risk_level || null,
          item_name: row.item_name || null,
          linked_shortage_count: Number(row.linked_shortage_count || 0),
          linked_work_order_count: Number(row.linked_work_order_count || 0),
          source_path: purchaseFollowupPath(instanceId, row.purchase_request_no || null),
        });
      }
    }

    if (tableExists("shortage_cases")) {
      const shortageRows = safeAll(`
        SELECT sc.*, m.material_code, m.material_name, wo.wo_code
        FROM shortage_cases sc
        LEFT JOIN materials m ON m.id = sc.material_id
        LEFT JOIN work_orders wo ON wo.id = sc.work_order_id
        WHERE sc.equipment_instance_id = ?
          AND COALESCE(sc.status, '') NOT IN ('closed', 'resolved', 'arrived', 'received', 'cancelled')
          AND (sc.purchase_request_no IS NOT NULL OR COALESCE(sc.status, '') IN ('following', 'purchasing'))
        ORDER BY COALESCE(sc.expected_date, sc.updated_at, sc.created_at) ASC, sc.id DESC
      `, [instanceId]);
      for (const row of shortageRows) {
        const key = `shortage:${row.id}`;
        if (seen.has(key)) continue;
        rows.push({
          id: `shortage_${row.id}`,
          source_type: "shortage",
          source_ref_id: Number(row.id),
          po_no: row.purchase_request_no || `SC-${row.id}`,
          purchase_request_no: row.purchase_request_no || null,
          planned_delivery: row.expected_date || null,
          actual_delivery: row.status === "arrived" ? (row.updated_at || row.created_at || null) : null,
          delay_days: row.expected_date ? Math.max(0, Math.floor((Date.now() - new Date(row.expected_date).getTime()) / 86400000)) : 0,
          tracking_status: normalizeTrackingStatus(row.status, row.purchase_request_no || null),
          urgent_tags: ["BOM风险催办", row.priority === "critical" ? "关键缺料" : null, row.work_order_id ? "影响工单" : null].filter(Boolean).join(" / "),
          owner_name: row.owner_name || null,
          remarks: row.last_note || null,
          risk_level: row.priority || null,
          item_name: `${row.material_code || ""} ${row.material_name || ""}`.trim() || `物料#${row.material_id}`,
          linked_shortage_count: 1,
          linked_work_order_count: row.work_order_id ? 1 : 0,
          source_path: purchaseFollowupPath(instanceId, row.purchase_request_no || null),
        });
      }
    }

    const normalizedRows = rows.map(enrichPurchaseFollowup);
    normalizedRows.sort((a, b) => String(a.planned_delivery || "").localeCompare(String(b.planned_delivery || "")) || Number(b.delay_days || 0) - Number(a.delay_days || 0));
    return normalizedRows;
  }

  return {
    purchaseFollowupPath,
    normalizeTrackingStatus,
    purchaseFollowupsForInstance,
  };
}

module.exports = { createPurchaseFollowupReader };
