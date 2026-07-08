"use strict";
// app/domain/statusCatalog.js
// Central status vocabulary for MES lifecycle state mapping.

const PURCHASE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "confirmed",
  "in_transit",
  "partially_received",
  "received",
  "closed",
  "cancelled",
];

const PURCHASE_FOLLOWUP_STATUSES = ["pending", "following", "delivered", "cancelled"];
const PURCHASE_FOLLOWUP_TERMINAL_STATUSES = ["delivered", "cancelled"];

const SHORTAGE_STATUSES = ["open", "assigned", "purchasing", "arrived", "closed", "cancelled"];
const SHORTAGE_TERMINAL_STATUSES = ["closed", "resolved", "arrived", "received", "cancelled"];

const EQUIPMENT_LIFECYCLE_STATUSES = [
  "design",
  "procurement",
  "manufacturing",
  "assembly",
  "commissioning",
  "acceptance",
  "delivered",
  "operation",
  "archived",
];

function normalizePurchaseFollowupStatus(status) {
  if (!status) return status;
  if (["closed", "arrived", "received"].includes(status)) return "delivered";
  if (status === "cancelled") return "cancelled";
  if (["following", "assigned", "purchasing"].includes(status)) return "following";
  return status;
}

function mapShortageToFollowupStatus(status, purchaseRequestNo) {
  const normalized = normalizePurchaseFollowupStatus(status);
  if (PURCHASE_FOLLOWUP_STATUSES.includes(normalized)) return normalized;
  return purchaseRequestNo ? "following" : "pending";
}

function isPurchaseFollowupTerminal(status) {
  return PURCHASE_FOLLOWUP_TERMINAL_STATUSES.includes(normalizePurchaseFollowupStatus(status));
}

function isShortageTerminal(status) {
  return SHORTAGE_TERMINAL_STATUSES.includes(String(status || ""));
}

module.exports = {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_FOLLOWUP_STATUSES,
  PURCHASE_FOLLOWUP_TERMINAL_STATUSES,
  SHORTAGE_STATUSES,
  SHORTAGE_TERMINAL_STATUSES,
  EQUIPMENT_LIFECYCLE_STATUSES,
  normalizePurchaseFollowupStatus,
  mapShortageToFollowupStatus,
  isPurchaseFollowupTerminal,
  isShortageTerminal,
};
