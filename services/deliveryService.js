"use strict";
const { wrap } = require("../middleware/asyncHandler");
const audit = require("../app/audit");


const { runMigration } = require("./delivery/migration");
const { createReadModel } = require("./delivery/readModel");
const { registerDeliveryRoutes } = require("./delivery/routes");

function register(app, db) {
  runMigration(db);
  const tableCache = new Map();
  const columnCache = new Map();
  defaultEscalationRules();

  function tableExists(name) {
    if (!tableCache.has(name)) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      tableCache.set(name, !!row);
    }
    return tableCache.get(name);
  }

  function columns(table) {
    if (!columnCache.has(table)) {
      if (!tableExists(table)) {
        columnCache.set(table, new Set());
      } else {
        columnCache.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)));
      }
    }
    return columnCache.get(table);
  }

  function has(table, column) {
    return columns(table).has(column);
  }

  function safeAll(sql, params = []) {
    try { return db.prepare(sql).all(params); } catch (_e) { return []; }
  }

  function safeGet(sql, params = []) {
    try { return db.prepare(sql).get(params) || null; } catch (_e) { return null; }
  }

  function safeRun(sql, params = []) {
    try { return db.prepare(sql).run(params); } catch (_e) { return null; }
  }

  function ensureColumn(table, column, definition) {
    if (!tableExists(table) || has(table, column)) return;
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      columnCache.delete(table);
    } catch (_e) {}
  }

  function actor(req) {
    return {
      id: req.user?.uid || req.user?.sub || req.user?.id || null,
      name: req.user?.full_name || req.user?.username || req.user?.name || null,
    };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function caseFor(exceptionId) {
    return safeGet("SELECT * FROM exception_cases WHERE exception_id = ?", [exceptionId]);
  }

  function ensureCase(exceptionId, patch = {}) {
    const existing = caseFor(exceptionId);
    if (!existing) {
      db.prepare(`INSERT INTO exception_cases
        (exception_id, status, owner_id, owner_name, priority, due_at, last_action)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        exceptionId,
        patch.status || "open",
        patch.owner_id || null,
        patch.owner_name || null,
        patch.priority || null,
        patch.due_at || null,
        patch.last_action || null
      );
      return caseFor(exceptionId);
    }

    const fields = [];
    const params = [];
    for (const key of ["status", "owner_id", "owner_name", "priority", "due_at", "closed_at", "closed_by", "close_note", "last_action"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = ?`);
        params.push(patch[key]);
      }
    }
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      params.push(exceptionId);
      db.prepare(`UPDATE exception_cases SET ${fields.join(", ")} WHERE exception_id = ?`).run(params);
    }
    return caseFor(exceptionId);
  }

  function addAction(req, exceptionId, action, note, patch = {}) {
    const ownerId = Object.prototype.hasOwnProperty.call(patch, "owner_id") ? patch.owner_id : null;
    const ownerName = Object.prototype.hasOwnProperty.call(patch, "owner_name") ? patch.owner_name : null;
    const a = actor(req);
    db.prepare(`INSERT INTO exception_actions
      (exception_id, action, note, owner_id, owner_name, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(exceptionId, action, note || null, ownerId, ownerName, a.id, a.name);
    audit.record(db, req, {
      action: `exception.${action}`,
      resource_type: "exception",
      resource_id: exceptionId,
      after: { exception_id: exceptionId, action, note, ...patch },
    });
  }

  function actionsFor(exceptionId) {
    return safeAll("SELECT * FROM exception_actions WHERE exception_id = ? ORDER BY id DESC", [exceptionId]);
  }

  function defaultEscalationRules() {
    const count = safeGet("SELECT COUNT(*) AS c FROM exception_escalation_rules")?.c || 0;
    if (count > 0) return;
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["严重异常2小时升级", null, "critical", 2, "项目经理"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["高风险异常8小时升级", null, "high", 8, "班组长"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["缺料24小时升级采购", "kit_shortage", null, 24, "采购负责人"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["质量NCR24小时升级质量经理", "quality_ncr", null, 24, "质量经理"]);
  }

  function hoursSince(value) {
    if (!value) return 0;
    const t = new Date(String(value).replace(" ", "T") + "Z").getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, (Date.now() - t) / 3600000);
  }

  function matchedEscalationRule(item) {
    const rules = safeAll(`
      SELECT *
      FROM exception_escalation_rules
      WHERE is_active = 1
        AND (type IS NULL OR type = '' OR type = ?)
        AND (severity IS NULL OR severity = '' OR severity = ?)
      ORDER BY
        CASE WHEN type = ? THEN 0 ELSE 1 END,
        CASE WHEN severity = ? THEN 0 ELSE 1 END,
        escalate_after_hours ASC
    `, [item.type, item.severity, item.type, item.severity]);
    const age = hoursSince(item.created_at || item.due_at);
    return rules.find((r) => age >= Number(r.escalate_after_hours || 0)) || null;
  }

  function alreadyNotifiedToday(exceptionId, eventType) {
    const row = safeGet(`
      SELECT id FROM exception_notifications
      WHERE exception_id = ?
        AND event_type = ?
        AND created_at >= datetime('now', '-1 day')
      LIMIT 1
    `, [exceptionId, eventType]);
    return Boolean(row);
  }

  async function sendExceptionNotice(req, item, eventType, note, targetRole) {
    const { feishuNotify } = require("./feishuNotify");
    const titlePrefix = eventType === "escalate" ? "🚨 MES异常升级" : "🔔 MES异常提醒";
    const title = `${titlePrefix}: ${item.title}`;
    const content = [
      `**类型**: ${item.type}`,
      `**级别**: ${item.severity}`,
      `**项目**: ${item.instance_code || "-"}`,
      `**责任人**: ${item.owner_name || "-"}`,
      targetRole ? `**升级给**: ${targetRole}` : null,
      `**说明**: ${item.message || "-"}`,
      note ? `**备注**: ${note}` : null,
      `**入口**: ${item.source_path || "/exceptions"}`,
    ].filter(Boolean).join("\n");
    const result = await feishuNotify(title, content);
    const a = req ? actor(req) : { id: null };
    safeRun(`
      INSERT INTO exception_notifications
        (exception_id, event_type, channel, title, content, target_role, result_json, created_by)
      VALUES (?, ?, 'feishu', ?, ?, ?, ?, ?)
    `, [item.id, eventType, title, content, targetRole || null, JSON.stringify(result || {}), a.id || null]);
    if (req) {
      ensureCase(item.id, { status: item.case_status || "open", priority: item.priority || item.severity || null, last_action: eventType });
      addAction(req, item.id, eventType === "escalate" ? "escalate" : "notify", note || title, {});
    }
    return result;
  }

  function enrichEscalation(items) {
    return items.map((item) => {
      if (item.case_status === "closed") return item;
      const rule = matchedEscalationRule(item);
      return {
        ...item,
        escalation_rule_id: rule?.id || null,
        escalation_rule_name: rule?.name || null,
        escalation_to_role: rule?.escalate_to_role || null,
        escalation_due: Boolean(rule),
      };
    });
  }

  function linkedSource(exceptionId) {
    const shortage = /^shortage_(\d+)$/.exec(exceptionId);
    if (shortage) return { type: "shortage", id: Number(shortage[1]) };
    const ncr = /^ncr_(\d+)$/.exec(exceptionId);
    if (ncr) return { type: "ncr", id: Number(ncr[1]) };
    const mdm = /^mdm_(.+)$/.exec(exceptionId);
    if (mdm) return { type: "mdm", id: mdm[1] };
    return null;
  }

  function nextPurchaseRequestNo() {
    if (!tableExists("shortage_cases")) return `PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`;
    const prefix = "PR-" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = safeGet("SELECT purchase_request_no FROM shortage_cases WHERE purchase_request_no LIKE ? ORDER BY purchase_request_no DESC LIMIT 1", [prefix + "%"]);
    const seq = row?.purchase_request_no ? Number(String(row.purchase_request_no).split("-").pop() || 0) + 1 : 1;
    return `${prefix}-${String(seq).padStart(3, "0")}`;
  }

  function ncrClosureState(ncrId) {
    const ncr = safeGet("SELECT * FROM ncr_reports WHERE id = ?", [ncrId]);
    if (!ncr) return { exists: false, canClose: false, reason: "NCR not found" };
    if (ncr.closed_at) return { exists: true, ncr, canClose: true, alreadyClosed: true };
    const capas = safeAll("SELECT status FROM capa_actions WHERE ncr_id = ?", [ncrId]);
    const rechecks = safeAll("SELECT result FROM ncr_rechecks WHERE ncr_id = ?", [ncrId]);
    const hasDisposition = ncr.disposition && ncr.disposition !== "pending";
    const hasOpenCapa = capas.some((c) => c.status !== "closed");
    const hasFailedRecheck = rechecks.some((r) => r.result === "fail");
    const hasPassRecheck = rechecks.some((r) => r.result === "pass");
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
      try {
        const mdm = require("./masterDataService");
        if (mdm && typeof mdm.waiveIssue === "function") mdm.waiveIssue(db, source.id, note || "异常中心关闭");
      } catch (_e) {}
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
      try {
        const mdm = require("./masterDataService");
        if (mdm && typeof mdm.reopenIssue === "function") mdm.reopenIssue(db, source.id);
      } catch (_e) {}
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
    const prNo = shortage.purchase_request_no || nextPurchaseRequestNo();
    const nextStatus = shortage.expected_date ? "purchasing" : "following";
    safeRun(`UPDATE shortage_cases
      SET purchase_request_no = ?,
          status = ?,
          closed_at = NULL,
          last_note = COALESCE(?, last_note),
          updated_at = datetime('now')
      WHERE id = ?`, [prNo, nextStatus, note || "异常中心重新发起采购催办", source.id]);
    const refreshed = safeGet("SELECT * FROM shortage_cases WHERE id = ?", [source.id]) || shortage;
    return {
      ok: true,
      purchase_request_no: prNo,
      status: nextStatus,
      instance_id: refreshed.equipment_instance_id || null,
      path: purchaseFollowupPath(refreshed.equipment_instance_id || null, prNo),
      shortage: refreshed,
    };
  }

  const readModel = createReadModel({ db, tableExists, has, columns, safeAll, safeGet, enrichEscalation });

  registerDeliveryRoutes(app, {
    wrap,
    readModel,
    safeGet,
    caseFor,
    ensureCase,
    addAction,
    actionsFor,
    actor,
    today,
    syncSourceAssign,
    syncSourceStart,
    syncSourceClose,
    syncSourceReopen,
    restartPurchaseFollowup,
    sendExceptionNotice,
    alreadyNotifiedToday,
  });

}

module.exports = { register };
