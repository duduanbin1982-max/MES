"use strict";

const { EQUIPMENT_LIFECYCLE_STATUSES } = require("./statusCatalog");

const LEGACY_LIFECYCLE_ALIASES = {
  designing: "design",
  purchasing: "procurement",
};

const ALLOWED_TRANSITIONS = {
  design: ["procurement", "archived"],
  procurement: ["design", "manufacturing", "archived"],
  manufacturing: ["procurement", "assembly", "archived"],
  assembly: ["manufacturing", "commissioning", "archived"],
  commissioning: ["assembly", "acceptance", "archived"],
  acceptance: ["commissioning", "delivered", "archived"],
  delivered: ["operation", "archived"],
  operation: ["archived"],
  archived: [],
};

function normalizeLifecycleStatus(status) {
  const raw = String(status || "design").trim().toLowerCase();
  return LEGACY_LIFECYCLE_ALIASES[raw] || raw;
}

function canTransitionLifecycle(fromStatus, toStatus) {
  const from = normalizeLifecycleStatus(fromStatus);
  const to = normalizeLifecycleStatus(toStatus);
  if (from === to && EQUIPMENT_LIFECYCLE_STATUSES.includes(to)) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

function lifecycleTransitionReason(fromStatus, toStatus) {
  const from = normalizeLifecycleStatus(fromStatus);
  const to = normalizeLifecycleStatus(toStatus);
  if (!EQUIPMENT_LIFECYCLE_STATUSES.includes(from)) return `未知当前状态: ${from}`;
  if (!EQUIPMENT_LIFECYCLE_STATUSES.includes(to)) return `未知目标状态: ${to}`;
  if (canTransitionLifecycle(from, to)) return "";
  return `不允许从 ${from} 流转到 ${to}`;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  EQUIPMENT_LIFECYCLE_STATUSES,
  LEGACY_LIFECYCLE_ALIASES,
  canTransitionLifecycle,
  lifecycleTransitionReason,
  normalizeLifecycleStatus,
};
