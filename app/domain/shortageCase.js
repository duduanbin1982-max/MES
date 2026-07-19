"use strict";

const { SHORTAGE_STATUSES, SHORTAGE_TERMINAL_STATUSES } = require("./statusCatalog");

const ACTIVE_SHORTAGE_STATUSES = new Set(SHORTAGE_STATUSES.filter((status) => !SHORTAGE_TERMINAL_STATUSES.includes(status)));
const TERMINAL_SHORTAGE_STATUSES = new Set(SHORTAGE_TERMINAL_STATUSES);
const FULFILLED_SHORTAGE_STATUSES = new Set(["resolved", "closed", "arrived", "received"]);

function normalizeShortageStatus(status) {
  return String(status || "open").trim().toLowerCase();
}

function isShortageActive(status) {
  return !TERMINAL_SHORTAGE_STATUSES.has(normalizeShortageStatus(status));
}

function isShortageTerminal(status) {
  return TERMINAL_SHORTAGE_STATUSES.has(normalizeShortageStatus(status));
}

function isShortageResolved(status) {
  return isShortageTerminal(status);
}

function isShortageFulfilled(status) {
  return FULFILLED_SHORTAGE_STATUSES.has(normalizeShortageStatus(status));
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
  FULFILLED_SHORTAGE_STATUSES,
  TERMINAL_SHORTAGE_STATUSES,
  isShortageActive,
  isShortageFulfilled,
  isShortageResolved,
  isShortageTerminal,
  nextShortageStateForFollowup,
  normalizeShortageStatus,
};
