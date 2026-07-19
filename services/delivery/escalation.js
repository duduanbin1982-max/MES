"use strict";

function createEscalationService({ safeAll, safeGet, safeRun, actor, ensureCase, addAction }) {
  function ensureDefaultRules() {
    const count = safeGet("SELECT COUNT(*) AS c FROM exception_escalation_rules")?.c || 0;
    if (count > 0) return;
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["严重异常2小时升级", null, "critical", 2, "项目经理"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["高风险异常8小时升级", null, "high", 8, "班组长"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["缺料24小时升级采购", "kit_shortage", null, 24, "采购负责人"]);
    safeRun("INSERT INTO exception_escalation_rules (name, type, severity, escalate_after_hours, escalate_to_role) VALUES (?, ?, ?, ?, ?)", ["质量NCR24小时升级质量经理", "quality_ncr", null, 24, "质量经理"]);
  }

  function hoursSince(value) {
    if (!value) return 0;
    const timestamp = new Date(String(value).replace(" ", "T") + "Z").getTime();
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, (Date.now() - timestamp) / 3600000);
  }

  function matchedRule(item) {
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
    return rules.find((rule) => age >= Number(rule.escalate_after_hours || 0)) || null;
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
    const { feishuNotify } = require("../feishuNotify");
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
    const currentActor = req ? actor(req) : { id: null };
    safeRun(`
      INSERT INTO exception_notifications
        (exception_id, event_type, channel, title, content, target_role, result_json, created_by)
      VALUES (?, ?, 'feishu', ?, ?, ?, ?, ?)
    `, [item.id, eventType, title, content, targetRole || null, JSON.stringify(result || {}), currentActor.id || null]);
    if (req) {
      ensureCase(item.id, { status: item.case_status || "open", priority: item.priority || item.severity || null, last_action: eventType });
      addAction(req, item.id, eventType === "escalate" ? "escalate" : "notify", note || title, {});
    }
    return result;
  }

  function enrichEscalation(items) {
    return items.map((item) => {
      if (item.case_status === "closed") return item;
      const rule = matchedRule(item);
      return {
        ...item,
        escalation_rule_id: rule?.id || null,
        escalation_rule_name: rule?.name || null,
        escalation_to_role: rule?.escalate_to_role || null,
        escalation_due: Boolean(rule),
      };
    });
  }

  return { alreadyNotifiedToday, enrichEscalation, ensureDefaultRules, sendExceptionNotice };
}

module.exports = { createEscalationService };
