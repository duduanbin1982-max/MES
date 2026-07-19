"use strict";

function deliveryStageStatus(done, total, blockers = []) {
  if (blockers.some((blocker) => blocker.severity === "critical" || blocker.severity === "high")) return "blocked";
  if (blockers.length) return "warning";
  if (total === 0) return "empty";
  if (done >= total) return "done";
  if (done > 0) return "running";
  return "pending";
}

function buildDeliveryStage({ key, label, done, total, path, ownerRole, actionLabel, blockers = [], status }, percentage) {
  return {
    key,
    label,
    done,
    total,
    percent: percentage(done, total),
    status: status || deliveryStageStatus(done, total, blockers),
    path,
    owner_role: ownerRole || "项目经理",
    action_label: actionLabel || "去处理",
    blockers,
    blocker_count: blockers.length,
  };
}

function summarizeDeliveryWorkflow(stages = []) {
  const blockers = stages.flatMap((stage) => stage.blockers.map((blocker) => ({ ...blocker, stage_key: stage.key, stage_label: stage.label })));
  const status = blockers.some((blocker) => blocker.severity === "critical" || blocker.severity === "high")
    ? "blocked"
    : blockers.length
      ? "warning"
      : "normal";
  return { blockers, blocker_count: blockers.length, status };
}

module.exports = { buildDeliveryStage, deliveryStageStatus, summarizeDeliveryWorkflow };
