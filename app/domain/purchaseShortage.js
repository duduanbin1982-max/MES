"use strict";

const ACTIVE_SHORTAGE_STATUSES = new Set(["open", "pending", "assigned", "followup", "reopened", "blocked"]);
const RESOLVED_SHORTAGE_STATUSES = new Set(["resolved", "closed", "arrived", "cancelled"]);

function normalizeShortageStatus(status) {
  return String(status || "open").trim().toLowerCase();
}

function isShortageActive(status) {
  const normalized = normalizeShortageStatus(status);
  return !RESOLVED_SHORTAGE_STATUSES.has(normalized);
}

function isShortageResolved(status) {
  return RESOLVED_SHORTAGE_STATUSES.has(normalizeShortageStatus(status));
}

function nextShortageStateForFollowup(action) {
  const normalized = String(action || "").trim().toLowerCase();
  if (["arrive", "arrived", "receive", "received", "close", "closed"].includes(normalized)) return "closed";
  if (["cancel", "cancelled"].includes(normalized)) return "reopened";
  if (["assign", "reassign"].includes(normalized)) return "assigned";
  if (["urge", "followup", "restart"].includes(normalized)) return "followup";
  return "open";
}

module.exports = {
  ACTIVE_SHORTAGE_STATUSES,
  RESOLVED_SHORTAGE_STATUSES,
  isShortageActive,
  isShortageResolved,
  nextShortageStateForFollowup,
  normalizeShortageStatus,
};
