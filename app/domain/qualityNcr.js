"use strict";

function isDispositionDone(ncr) {
  return Boolean(ncr && ncr.disposition && ncr.disposition !== "pending");
}

function evaluateNcrClosure(ncr, capaActions = [], rechecks = []) {
  const hasDisposition = isDispositionDone(ncr);
  const hasOpenCapa = (capaActions || []).some((action) => action.status !== "closed");
  const hasFailedRecheck = (rechecks || []).some((recheck) => recheck.result === "fail");
  const hasPassRecheck = (rechecks || []).some((recheck) => recheck.result === "pass");
  const recheckPassed = ncr?.disposition === "accept" || hasPassRecheck;
  const checklist = {
    disposition_done: hasDisposition,
    capa_all_closed: !hasOpenCapa,
    recheck_passed: recheckPassed,
    has_failed_recheck: hasFailedRecheck,
  };
  const blockers = [];
  if (!checklist.disposition_done) blockers.push("NCR 尚未处置");
  if (!checklist.capa_all_closed) blockers.push("CAPA 未全部关闭");
  if (checklist.has_failed_recheck) blockers.push("存在复检失败记录");
  if (!checklist.recheck_passed) blockers.push("未通过复检或让步接收");
  const canClose = Boolean(ncr?.closed_at) || blockers.length === 0;
  return {
    checklist,
    blockers,
    canClose,
    status: ncr?.closed_at ? "closed" : hasDisposition ? "disposed" : "open",
  };
}

function appendClosureNote(rootCause, note) {
  if (!note) return rootCause || null;
  return [rootCause || "", `关闭说明: ${note}`].filter(Boolean).join("\n");
}

module.exports = {
  appendClosureNote,
  evaluateNcrClosure,
  isDispositionDone,
};
