// services/purchase/followupEffects.js
"use strict";

const { ApiError } = require("../../app/errors");
const { isPurchaseFollowupTerminal } = require("../../app/domain/statusCatalog");
const { tableExists } = require("./trackingStore");
const { normalizeFollowupStatus } = require("./trackingSync");

const TRACKING_UPDATE_FIELDS = ["planned_delivery", "actual_delivery", "status", "urgent_tags", "remarks", "owner_name", "owner_id"];

function parseIdList(jsonText) {
  try {
    return JSON.parse(jsonText || "[]");
  } catch (_error) {
    return [];
  }
}

function calculateDelayDays(plannedDelivery, actualDelivery, status, now = Date.now()) {
  if (plannedDelivery && actualDelivery) {
    return Math.max(0, Math.floor((new Date(actualDelivery).getTime() - new Date(plannedDelivery).getTime()) / 86400000));
  }
  if (plannedDelivery && !isPurchaseFollowupTerminal(status)) {
    return Math.max(0, Math.floor((now - new Date(plannedDelivery).getTime()) / 86400000));
  }
  return 0;
}

function deriveFollowupTransition(tracking, body = {}, now = Date.now()) {
  const normalizedInputStatus = normalizeFollowupStatus(body.status);
  const nextPlannedDelivery = body.planned_delivery !== undefined ? body.planned_delivery : tracking.planned_delivery;
  const nextActualDelivery = body.actual_delivery !== undefined ? body.actual_delivery : tracking.actual_delivery;
  const nextOwnerId = body.owner_id !== undefined ? body.owner_id : tracking.owner_id;
  const nextOwnerName = body.owner_name !== undefined ? body.owner_name : tracking.owner_name;
  const priorTrackingStatus = normalizeFollowupStatus(tracking.status);
  let nextTrackingStatus = body.status !== undefined ? normalizedInputStatus : tracking.status;

  if (nextActualDelivery && body.status === undefined) nextTrackingStatus = "delivered";
  else if (body.status === undefined && nextTrackingStatus === "pending" && (nextPlannedDelivery || nextOwnerId || nextOwnerName)) nextTrackingStatus = "following";

  const sets = [];
  const params = [];
  for (const key of TRACKING_UPDATE_FIELDS) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(key === "status" ? normalizedInputStatus : body[key]);
    }
  }
  if (body.status === undefined && nextTrackingStatus !== tracking.status) {
    sets.push("status = ?");
    params.push(nextTrackingStatus);
  }
  if (body.planned_delivery !== undefined || body.actual_delivery !== undefined || body.status !== undefined) {
    sets.push("delay_days = ?");
    params.push(calculateDelayDays(nextPlannedDelivery, nextActualDelivery, nextTrackingStatus, now));
  }

  const shouldCloseShortages = nextTrackingStatus === "delivered";
  const shouldReopenShortages = !shouldCloseShortages && (
    normalizedInputStatus === "cancelled"
    || isPurchaseFollowupTerminal(priorTrackingStatus)
    || (body.actual_delivery !== undefined && !nextActualDelivery)
  );
  const mappedShortageStatus = shouldCloseShortages
    ? "closed"
    : shouldReopenShortages
      ? (nextTrackingStatus === "following"
        ? (nextPlannedDelivery ? "purchasing" : ((nextOwnerId || nextOwnerName) ? "assigned" : "open"))
        : ((nextOwnerId || nextOwnerName) ? "assigned" : "open"))
      : normalizedInputStatus === "cancelled"
        ? "cancelled"
        : normalizedInputStatus === "following"
          ? "following"
          : normalizedInputStatus === "pending"
            ? "open"
            : null;
  const derivedShortageStatus = mappedShortageStatus
    || (nextActualDelivery && nextTrackingStatus === "delivered" ? "closed" : null)
    || (nextPlannedDelivery ? "purchasing" : null)
    || ((nextOwnerId || nextOwnerName) ? "assigned" : null);

  return {
    normalizedInputStatus,
    priorTrackingStatus,
    nextTrackingStatus,
    nextPlannedDelivery,
    nextActualDelivery,
    nextOwnerId,
    nextOwnerName,
    sets,
    params,
    shouldCloseShortages,
    shouldReopenShortages,
    derivedShortageStatus,
  };
}

function targetShortageIdsForTracking(tracking) {
  const shortageIds = parseIdList(tracking.linked_shortage_ids).map((id) => Number(id)).filter(Boolean);
  return tracking.source_type === "shortage" && tracking.source_ref_id
    ? [Number(tracking.source_ref_id), ...shortageIds]
    : shortageIds;
}

function archiveShortageExceptions(db, helpers, shortageIds, note, req) {
  if (!tableExists(db, "exception_cases")) return;
  const { get, run } = helpers;
  const userId = req?.user?.uid || req?.user?.sub || req?.user?.id || null;
  const userName = req?.user?.full_name || req?.user?.username || req?.user?.name || null;
  for (const shortageId of [...new Set(shortageIds.map((id) => Number(id)).filter(Boolean))]) {
    const exceptionId = `shortage_${shortageId}`;
    const existing = get("SELECT exception_id FROM exception_cases WHERE exception_id = ?", [exceptionId]);
    if (existing) {
      run(`UPDATE exception_cases
           SET status = 'closed',
               closed_at = COALESCE(closed_at, datetime('now')),
               closed_by = COALESCE(?, closed_by),
               close_note = ?,
               last_action = 'auto_close_by_purchase_followup',
               updated_at = datetime('now')
           WHERE exception_id = ?`, [userId, note || "采购跟催已到货/已关闭，自动归档异常", exceptionId]);
    } else {
      run(`INSERT INTO exception_cases
            (exception_id, status, closed_at, closed_by, close_note, last_action)
           VALUES (?, 'closed', datetime('now'), ?, ?, 'auto_close_by_purchase_followup')`,
        [exceptionId, userId, note || "采购跟催已到货/已关闭，自动归档异常"]);
    }
    if (tableExists(db, "exception_actions")) {
      run(`INSERT INTO exception_actions
            (exception_id, action, note, created_by, created_by_name)
           VALUES (?, 'close', ?, ?, ?)`,
        [exceptionId, note || "采购跟催已到货/已关闭，自动归档异常", userId, userName]);
    }
  }
}

function reopenShortageExceptions(db, helpers, shortageIds, note) {
  if (!tableExists(db, "exception_cases")) return;
  const { get, run } = helpers;
  for (const shortageId of [...new Set(shortageIds.map((id) => Number(id)).filter(Boolean))]) {
    const shortage = get(`SELECT id, owner_id, owner_name, expected_date, priority, status
                          FROM shortage_cases
                          WHERE id = ?`, [shortageId]);
    if (!shortage) continue;
    const exceptionId = `shortage_${shortageId}`;
    const caseStatus = shortage.owner_id || shortage.owner_name ? "assigned" : "open";
    const existing = get("SELECT exception_id FROM exception_cases WHERE exception_id = ?", [exceptionId]);
    if (existing) {
      run(`UPDATE exception_cases
           SET status = ?,
               owner_id = ?,
               owner_name = ?,
               priority = COALESCE(?, priority),
               due_at = ?,
               closed_at = NULL,
               closed_by = NULL,
               close_note = NULL,
               last_action = 'auto_reopen_by_purchase_followup_cancel',
               updated_at = datetime('now')
           WHERE exception_id = ?`,
        [caseStatus, shortage.owner_id || null, shortage.owner_name || null, shortage.priority || null, shortage.expected_date || null, exceptionId]);
    } else {
      run(`INSERT INTO exception_cases
            (exception_id, status, owner_id, owner_name, priority, due_at, last_action)
           VALUES (?, ?, ?, ?, ?, ?, 'auto_reopen_by_purchase_followup_cancel')`,
        [exceptionId, caseStatus, shortage.owner_id || null, shortage.owner_name || null, shortage.priority || null, shortage.expected_date || null]);
    }
    if (tableExists(db, "exception_actions")) {
      run(`INSERT INTO exception_actions
            (exception_id, action, note, owner_id, owner_name)
           VALUES (?, 'reopen', ?, ?, ?)`,
        [exceptionId, note || "采购跟催已取消，自动重开缺料异常", shortage.owner_id || null, shortage.owner_name || null]);
    }
  }
}

function applyShortageFollowupEffects(db, helpers, tracking, body, transition, req) {
  if (!tableExists(db, "shortage_cases")) return;
  const { run } = helpers;
  const targetShortageIds = targetShortageIdsForTracking(tracking);
  for (const shortageId of [...new Set(targetShortageIds)]) {
    const patchSets = [];
    const patchParams = [];
    if (body.planned_delivery !== undefined) { patchSets.push("expected_date = ?"); patchParams.push(body.planned_delivery || null); }
    if (body.owner_id !== undefined) { patchSets.push("owner_id = ?"); patchParams.push(body.owner_id || null); }
    if (body.owner_name !== undefined) { patchSets.push("owner_name = ?"); patchParams.push(body.owner_name || null); }
    if (body.remarks !== undefined) { patchSets.push("last_note = ?"); patchParams.push(body.remarks || null); }
    if (transition.normalizedInputStatus === "cancelled") patchSets.push("purchase_request_no = NULL");
    if (transition.derivedShortageStatus) { patchSets.push("status = ?"); patchParams.push(transition.derivedShortageStatus); }
    if (transition.shouldCloseShortages) patchSets.push("closed_at = COALESCE(closed_at, datetime('now'))");
    if (transition.shouldReopenShortages) patchSets.push("closed_at = NULL");
    if (!patchSets.length) continue;
    patchSets.push("updated_at = datetime('now')");
    patchParams.push(shortageId);
    run(`UPDATE shortage_cases SET ${patchSets.join(", ")} WHERE id = ?`, patchParams);
  }
  if (transition.shouldCloseShortages) archiveShortageExceptions(db, helpers, targetShortageIds, body.remarks || "采购跟催已到货/已关闭，自动归档异常", req);
  if (transition.shouldReopenShortages) reopenShortageExceptions(db, helpers, targetShortageIds, body.remarks || "采购跟催已取消，自动重开缺料异常");
}

function applyFollowupUpdate(db, helpers, trackingId, body = {}, req = null) {
  const { get, run } = helpers;
  const tracking = get("SELECT * FROM purchase_tracking WHERE id = ?", [trackingId]);
  if (!tracking) throw ApiError.notFound("采购跟催记录不存在");
  const transition = deriveFollowupTransition(tracking, body);
  if (!transition.sets.length) throw ApiError.validation("无可更新字段");
  transition.sets.push("updated_at = datetime('now')");
  transition.params.push(trackingId);
  run(`UPDATE purchase_tracking SET ${transition.sets.join(", ")} WHERE id = ?`, transition.params);
  if (Number(tracking.purchase_order_id) > 0 && body.planned_delivery !== undefined) {
    run("UPDATE purchase_orders SET expected_date = ?, updated_at = datetime('now') WHERE id = ?", [body.planned_delivery, tracking.purchase_order_id]);
  }
  applyShortageFollowupEffects(db, helpers, tracking, body, transition, req);
  return get("SELECT * FROM purchase_tracking WHERE id = ?", [trackingId]);
}

module.exports = {
  parseIdList,
  calculateDelayDays,
  deriveFollowupTransition,
  targetShortageIdsForTracking,
  applyShortageFollowupEffects,
  applyFollowupUpdate,
};
