"use strict";

const catalog = require("../../shared/statusCatalog.json");

const PURCHASE_ORDER_STATUSES = [...catalog.purchaseOrder.statuses];
const PURCHASE_FOLLOWUP_STATUSES = [...catalog.purchaseFollowup.statuses];
const PURCHASE_FOLLOWUP_TERMINAL_STATUSES = [...catalog.purchaseFollowup.terminalStatuses];
const SHORTAGE_STATUSES = [...catalog.shortage.statuses];
const SHORTAGE_TERMINAL_STATUSES = [...catalog.shortage.terminalStatuses];
const EQUIPMENT_LIFECYCLE_META = { ...catalog.equipmentLifecycle.meta };
const EQUIPMENT_LIFECYCLE_STATUSES = Object.keys(EQUIPMENT_LIFECYCLE_META);

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
  EQUIPMENT_LIFECYCLE_META,
  EQUIPMENT_LIFECYCLE_STATUSES,
  normalizePurchaseFollowupStatus,
  mapShortageToFollowupStatus,
  isPurchaseFollowupTerminal,
  isShortageTerminal,
};
