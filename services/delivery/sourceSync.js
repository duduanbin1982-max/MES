"use strict";

const { purchaseFollowupPath } = require("./readModel/purchaseFollowups");

function createSourceSync({ db, tableExists, safeAll, safeGet, safeRun, ensureColumn }) {
  function linkedSource(exceptionId) {
    const shortage = /^shortage_(\d+)$/.exec(exceptionId);
    if (shortage) return { type: "shortage", id: Number(shortage[1]) };
    const ncr = /^ncr_(\d+)$/.exec(exceptionId);
    if (ncr) return { type: "ncr", id: Number(ncr[1]) };
    const masterData = /^mdm_(.+)$/.exec(exceptionId);
    if (masterData) return { type: "mdm", id: masterData[1] };
    return null;
  }

  function nextPurchaseRequestNo() {
    if (!tableExists("shortage_cases")) return `PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`;
    const prefix = "PR-" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = safeGet("SELECT purchase_request_no FROM shortage_cases WHERE purchase_request_no LIKE ? ORDER BY purchase_request_no DESC LIMIT 1", [prefix + "%"]);
    const sequence = row?.purchase_request_no ? Number(String(row.purchase_request_no).split("-").pop() || 0) + 1 : 1;
    return `${prefix}-${String(sequence).padStart(3, "0")}`;
  }

  function ncrClosureState(ncrId) {
    const ncr = safeGet("SELECT * FROM ncr_reports WHERE id = ?", [ncrId]);
    if (!ncr) return { exists: false, canClose: false, reason: "NCR not found" };
    if (ncr.closed_at) return { exists: true, ncr, canClose: true, alreadyClosed: true };
    const capaActions = safeAll("SELECT status FROM capa_actions WHERE ncr_id = ?", [ncrId]);
    const rechecks = safeAll("SELECT result FROM ncr_rechecks WHERE ncr_id = ?", [ncrId]);
    const hasDisposition = ncr.disposition && ncr.disposition !== "pending";
    const hasOpenCapa = capaActions.some((action) => action.status !== "closed");
    const hasFailedRecheck = rechecks.some((recheck) => recheck.result === "fail");
    const hasPassRecheck = rechecks.some((recheck) => recheck.result === "pass");
    const canClose = Boolean(hasDisposition && !hasOpenCapa && !hasFailedRecheck && (ncr.disposition === "accept" || hasPassRecheck));
    let reason = "";
    if (!hasDisposition) reason = "NCR尚未完成处置";
    else if (hasOpenCapa) reason = "CAPA尚未全部关闭";
    else if (hasFailedRecheck) reason = "存在失败复检记录";
    else if (ncr.disposition !== "accept" && !hasPassRecheck) reason = "返工/拒收后尚未登记通过复检";
    return { exists: true, ncr, canClose, reason };
  }

  function syncSourceAssign(exceptionId, user, patch = {}) {
    const source = linkedSource(exceptionId);
    if (!source) return;
    if (source.type === "shortage" && tableExists("shortage_cases")) {
      safeRun(`UPDATE shortage_cases
        SET owner_id = ?, owner_name = ?, status = CASE WHEN status = 'closed' THEN status ELSE 'assigned' END,
            expected_date = COALESCE(?, expected_date),
            last_note = COALESCE(?, last_note),
            updated_at = datetime('now')
        WHERE id = ?`, [user.id, user.full_name || user.username || String(user.id), patch.due_at || null, patch.note || null, source.id]);
    }
    if (source.type === "ncr" && tableExists("ncr_reports")) {
      ensureColumn("ncr_reports", "owner_id", "INTEGER");
      ensureColumn("ncr_reports", "owner_name", "TEXT");
      safeRun("UPDATE ncr_reports SET owner_id = ?, owner_name = ? WHERE id = ?", [user.id, user.full_name || user.username || String(user.id), source.id]);
    }
  }

  function syncSourceStart(exceptionId, note) {
    const source = linkedSource(exceptionId);
    if (!source) return;
    if (source.type === "shortage" && tableExists("shortage_cases")) {
      safeRun(`UPDATE shortage_cases
        SET status = CASE WHEN status IN ('open','assigned') THEN 'purchasing' ELSE status END,
            last_note = COALESCE(?, last_note),
            updated_at = datetime('now')
        WHERE id = ?`, [note || null, source.id]);
    }
  }

  function syncSourceClose(exceptionId, note) {
    const source = linkedSource(exceptionId);
    if (!source) return { ok: true, linked: false };
    if (source.type === "shortage" && tableExists("shortage_cases")) {
      const row = safeGet("SELECT id FROM shortage_cases WHERE id = ?", [source.id]);
      if (!row) return { ok: false, message: "缺料单不存在" };
      safeRun(`UPDATE shortage_cases
        SET status = 'closed',
            closed_at = COALESCE(closed_at, datetime('now')),
            last_note = COALESCE(?, last_note),
            updated_at = datetime('now')
        WHERE id = ?`, [note || null, source.id]);
      return { ok: true, linked: true };
    }
    if (source.type === "mdm") {
      const masterDataService = require("../masterDataService");
      masterDataService.waiveIssue(db, source.id, note || "异常中心关闭");
      return { ok: true, linked: true };
    }
    if (source.type === "ncr" && tableExists("ncr_reports")) {
      const state = ncrClosureState(source.id);
      if (!state.exists) return { ok: false, message: state.reason };
      if (!state.canClose) return { ok: false, message: state.reason || "NCR闭环条件未完成" };
      const rootCause = note ? [state.ncr.root_cause || "", `异常中心关闭说明: ${note}`].filter(Boolean).join("\n") : state.ncr.root_cause;
      safeRun("UPDATE ncr_reports SET closed_at = COALESCE(closed_at, datetime('now')), root_cause = ? WHERE id = ?", [rootCause || null, source.id]);
      return { ok: true, linked: true };
    }
    return { ok: true, linked: false };
  }

  function syncSourceReopen(exceptionId, note) {
    const source = linkedSource(exceptionId);
    if (!source) return;
    if (source.type === "shortage" && tableExists("shortage_cases")) {
      safeRun(`UPDATE shortage_cases
        SET status = 'open', closed_at = NULL, last_note = COALESCE(?, last_note), updated_at = datetime('now')
        WHERE id = ?`, [note || null, source.id]);
    }
    if (source.type === "ncr" && tableExists("ncr_reports")) {
      safeRun("UPDATE ncr_reports SET closed_at = NULL WHERE id = ?", [source.id]);
    }
    if (source.type === "mdm") {
      const masterDataService = require("../masterDataService");
      masterDataService.reopenIssue(db, source.id);
    }
  }

  function restartPurchaseFollowup(exceptionId, note) {
    const source = linkedSource(exceptionId);
    if (!source || source.type !== "shortage" || !tableExists("shortage_cases")) {
      return { ok: false, message: "仅缺料异常支持重新发起采购催办" };
    }
    ensureColumn("shortage_cases", "purchase_request_no", "TEXT");
    ensureColumn("shortage_cases", "owner_id", "INTEGER");
    ensureColumn("shortage_cases", "owner_name", "TEXT");
    ensureColumn("shortage_cases", "expected_date", "TEXT");
    ensureColumn("shortage_cases", "priority", "TEXT");
    ensureColumn("shortage_cases", "closed_at", "TEXT");
    ensureColumn("shortage_cases", "last_note", "TEXT");
    const shortage = safeGet("SELECT * FROM shortage_cases WHERE id = ?", [source.id]);
    if (!shortage) return { ok: false, message: "缺料单不存在" };
    const purchaseRequestNo = shortage.purchase_request_no || nextPurchaseRequestNo();
    const nextStatus = shortage.expected_date ? "purchasing" : "following";
    safeRun(`UPDATE shortage_cases
      SET purchase_request_no = ?,
          status = ?,
          closed_at = NULL,
          last_note = COALESCE(?, last_note),
          updated_at = datetime('now')
      WHERE id = ?`, [purchaseRequestNo, nextStatus, note || "异常中心重新发起采购催办", source.id]);
    const refreshed = safeGet("SELECT * FROM shortage_cases WHERE id = ?", [source.id]) || shortage;
    return {
      ok: true,
      purchase_request_no: purchaseRequestNo,
      status: nextStatus,
      instance_id: refreshed.equipment_instance_id || null,
      path: purchaseFollowupPath(refreshed.equipment_instance_id || null, purchaseRequestNo),
      shortage: refreshed,
    };
  }

  return { restartPurchaseFollowup, syncSourceAssign, syncSourceClose, syncSourceReopen, syncSourceStart };
}

module.exports = { createSourceSync };
