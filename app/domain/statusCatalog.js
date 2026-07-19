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

const EQUIPMENT_LIFECYCLE_META = {
  design: { label: "设计中", tag: "info" },
  procurement: { label: "采购中", tag: "warning" },
  manufacturing: { label: "制造中", tag: "primary" },
  assembly: { label: "总装中", tag: "primary" },
  commissioning: { label: "调试中", tag: "success" },
  acceptance: { label: "验收中", tag: "warning" },
  delivered: { label: "交付", tag: "success" },
  operation: { label: "运维", tag: "success" },
  archived: { label: "归档", tag: "danger" },
};

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
