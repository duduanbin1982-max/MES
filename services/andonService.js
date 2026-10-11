"use strict";
const { wrap } = require('../middleware/asyncHandler');
const { ApiError } = require('../app/errors');
// services/andonService.js
// P1 ANDON 安灯系统: 告警触发 / 确认 / 解决 / 查询 / 规则管理
//   GET    /api/andon/alerts              活跃告警列表
//   GET    /api/andon/alerts/:id           告警详情
//   POST   /api/andon/alerts/:id/ack       确认告警
//   POST   /api/andon/alerts/:id/resolve   解决告警
//   GET    /api/andon/stats                告警统计
//   POST   /api/andon/trigger              手动/外部触发告警
//   GET    /api/andon/rules                规则列表
//   POST   /api/andon/rules                新建规则
//   PUT    /api/andon/rules/:id            更新规则
//   POST   /api/andon/scan                 扫描所有规则 (批量检查)
// Author: 三狗子 | Date: 2026-06-26
// 2026-07-11 OWASP A10 P0-3: webhook URL 校验, 防 SSRF

const { emit, Events } = require("../app/ws/EventBus");
const { queryLowStock } = require("./material/core");
// P0-3 SSRF 防御
const { validateWebhookUrl, validateWebhookUrlSync } = require("./webhookValidator");

const logger = require("../app/logger").createLogger("andonService");

function register(app, db) {
  const all = (sql, p = []) => db.prepare(sql).all(p);
  const get = (sql, p = []) => db.prepare(sql).get(p);
  const run = (sql, p = []) => db.prepare(sql).run(p);

  // ====== 安灯通知渠道 & 升级规则表 ======
  run("CREATE TABLE IF NOT EXISTS andon_notify_channels (id INTEGER PRIMARY KEY, channel_type TEXT NOT NULL, channel_name TEXT, webhook_url TEXT, secret TEXT, is_active INTEGER DEFAULT 1, notify_severities TEXT DEFAULT 'critical,warning', created_at TEXT DEFAULT (datetime('now')))");
  run("CREATE TABLE IF NOT EXISTS andon_escalation_rules (id INTEGER PRIMARY KEY, andon_type TEXT, severity TEXT, escalate_after_minutes INTEGER, escalate_to_role TEXT, notify_channel_ids TEXT, is_active INTEGER DEFAULT 1)");
  

  /**
   * 告警去重: 同一 source_type + source_id + alert_type 在 cooldown 内不重复触发
   */
  function isDuplicate(alertType, sourceType, sourceId, cooldownMin) {
    const recent = get(
      "SELECT id FROM andon_alerts WHERE alert_type = ? AND source_type = ? AND source_id = ? AND created_at > datetime('now','-' || ? || ' minutes') LIMIT 1",
      [alertType, sourceType, sourceId, cooldownMin || 60]
    );
    return !!recent;
  }

  /**
   * 触发告警
   */
  function triggerAlert(alertType, sourceType, sourceId, title, message, severity, data, cooldownMin) {
    if (isDuplicate(alertType, sourceType, sourceId || 0, cooldownMin)) return null;
    const r = run(
      `INSERT INTO andon_alerts (alert_type, source_type, source_id, title, message, severity, triggered_by, data_json)
       VALUES (?, ?, ?, ?, ?, ?, 'system', ?)`,
      [alertType, sourceType, sourceId || null, title, message || title, severity || "warning", data ? JSON.stringify(data) : null]
    );
    const id = Number(r.lastInsertRowid);
    emit(Events.ANDON_TRIGGERED, { alert_id: id, alert_type: alertType, severity, title, source_type: sourceType, source_id: sourceId });
    return id;
  }

  async function sendNotification(channel, message) {
    // P0-1 brooks-lint: 用统一的 buildWebhookUrl + sendWebhook (R3 dup 收编)
    const { buildWebhookUrl, sendWebhook } = require('./webhookValidator');

    // 1. 构造 payload (按 channel_type 选)
    let payload;
    if (channel.channel_type === 'dingtalk') {
      payload = JSON.stringify({ msgtype: 'markdown', markdown: { title: message.title, text: message.text } });
    } else if (channel.channel_type === 'feishu') {
      payload = JSON.stringify({ msg_type: 'interactive', card: { header: { title: { tag: 'plain_text', content: message.title } }, elements: [{ tag: 'markdown', content: message.text }] } });
    } else {
      return { ok: false, error: 'unsupported channel_type: ' + channel.channel_type };
    }

    // 2. 用 buildWebhookUrl 校验 + 构造 (channel 存的是完整 URL, 标 fullUrl: true)
    const v = buildWebhookUrl(channel.webhook_url, { fullUrl: true, platform: channel.channel_type });
    if (v.error) {
      logger.warn('[andon notify] SSRF blocked:', channel.webhook_url, v.error);
      return { ok: false, error: 'webhook_url 被 SSRF 防护拦截: ' + v.error };
    }

    // 3. 统一发送
    return await sendWebhook(v.url, payload, { timeout: 5000 });
  }

  async function notifyChannels(alertType, severity, title, message) {
    const channels = all("SELECT * FROM andon_notify_channels WHERE is_active = 1 AND ',' || notify_severities || ',' LIKE '%' || ? || '%'", severity);
    for (const ch of channels) {
      try {
        const result = await sendNotification(ch, { title, text: message, severity });
        logger.info("[andon notify] channel:", ch.channel_name, "ok:", result.ok);
      } catch (e) { logger.error("[andon notify] error:", ch.channel_name, e.message); }
    }
  }

  // ====== 告警查询 ======
  app.get("/api/andon/alerts", wrap((req, res) => {
    const { status, severity, limit, source_type } = req.query;
    let sql = "SELECT aa.*, u.full_name AS ack_user FROM andon_alerts aa LEFT JOIN users u ON aa.acknowledged_by = u.id WHERE 1=1";
    const params = [];
    if (status) { sql += " AND aa.status = ?"; params.push(status); }
    else { sql += " AND aa.status IN ('open','acknowledged')"; }
    if (severity) { sql += " AND aa.severity = ?"; params.push(severity); }
    if (source_type) { sql += " AND aa.source_type = ?"; params.push(source_type); }
    sql += " ORDER BY CASE aa.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, aa.created_at DESC";
    sql += " LIMIT ?"; params.push(parseInt(limit) || 100);

    const rows = all(sql, params);
    res.json({ alerts: rows, count: rows.length });
  }));

  app.get("/api/andon/alerts/:id", wrap((req, res) => {
    const alert = get(
      `SELECT aa.*, u1.full_name AS ack_user, u2.full_name AS resolve_user
       FROM andon_alerts aa
       LEFT JOIN users u1 ON aa.acknowledged_by = u1.id
       LEFT JOIN users u2 ON aa.resolved_by = u2.id
       WHERE aa.id = ?`,
      req.params.id
    );
    if (!alert) return res.status(404).json({ error: "告警不存在" });
    if (alert.data_json) {
      try {
        alert.data = JSON.parse(alert.data_json);
      } catch (_error) {
        alert.data = null;
      }
    }
    res.json(alert);
  }));

  // ====== 确认告警 ======
  app.post("/api/andon/alerts/:id/ack", wrap((req, res) => {
    const alert = get("SELECT * FROM andon_alerts WHERE id = ?", req.params.id);
    if (!alert) return res.status(404).json({ error: "告警不存在" });
    if (alert.status !== "open") return res.status(400).json({ error: "告警状态不是 open, 当前: " + alert.status });

    run(
      "UPDATE andon_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?",
      [req.user && req.user.sub, req.params.id]
    );
    emit(Events.ANDON_ACKED, { alert_id: Number(req.params.id), by: req.user && req.user.sub });
    res.json({ ok: true, id: Number(req.params.id), status: "acknowledged" });
  }));

  // ====== 解决告警 ======
  app.post("/api/andon/alerts/:id/resolve", wrap((req, res) => {
    const alert = get("SELECT * FROM andon_alerts WHERE id = ?", req.params.id);
    if (!alert) return res.status(404).json({ error: "告警不存在" });
    if (alert.status === "resolved") return res.status(400).json({ error: "告警已解决" });

    const { note } = req.body;
    run(
      "UPDATE andon_alerts SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ?",
      [req.user && req.user.sub, note || null, req.params.id]
    );
    emit(Events.ANDON_RESOLVED, { alert_id: Number(req.params.id), by: req.user && req.user.sub });
    res.json({ ok: true, id: Number(req.params.id), status: "resolved" });
  }));

  // ====== 告警统计 (增强) ======
  app.get("/api/andon/stats", wrap((req, res) => {
    const days = parseInt(req.query.days) || 30;
    const open = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE status = 'open'").n;
    const acked = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE status = 'acknowledged'").n;
    const danger = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE status IN ('open','acknowledged') AND severity = 'danger'").n;
    const today = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE created_at > datetime('now','start of day')").n;
    const byType = all("SELECT alert_type, COUNT(*) AS n FROM andon_alerts WHERE status IN ('open','acknowledged') GROUP BY alert_type ORDER BY n DESC");
    const bySeverity = all("SELECT severity, COUNT(*) AS n FROM andon_alerts WHERE created_at > datetime('now','-' || ? || ' days') GROUP BY severity", days);
    const avgAck = get("SELECT ROUND(AVG((julianday(acknowledged_at) - julianday(created_at)) * 1440)) AS minutes FROM andon_alerts WHERE acknowledged_at IS NOT NULL AND created_at > datetime('now','-' || ? || ' days')", days);
    const avgResolve = get("SELECT ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 1440)) AS minutes FROM andon_alerts WHERE resolved_at IS NOT NULL AND created_at > datetime('now','-' || ? || ' days')", days);
    const trend = all("SELECT date(created_at) AS date, COUNT(*) AS count FROM andon_alerts WHERE created_at > datetime('now','-' || ? || ' days') GROUP BY date(created_at) ORDER BY date", days);
    res.json({ total: open + acked, open, acknowledged: acked, danger, today, by_severity: Object.fromEntries(bySeverity.map(r => [r.severity, r.n])), by_type: byType, avg_ack_minutes: avgAck ? avgAck.minutes : null, avg_resolve_minutes: avgResolve ? avgResolve.minutes : null, trend });
  }));

  // ====== 手动触发告警 ======
  app.post("/api/andon/trigger", wrap((req, res) => {
    const { alert_type, source_type, source_id, title, message, severity, data } = req.body;
    if (!alert_type || !title) return res.status(400).json({ error: "alert_type/title 必填" });
    const id = triggerAlert(alert_type, source_type || "manual", source_id || null, title, message, severity || "warning", data, 0);
    res.status(201).json({ ok: true, alert_id: id });
  }));

  // ====== 规则管理 ======
  app.get("/api/andon/rules", wrap((_req, res) => {
    const rules = all("SELECT * FROM andon_rules ORDER BY id");
    for (const r of rules) {
      try { r.condition = JSON.parse(r.condition_json); } catch (_e) { r.condition = {}; }
    }
    res.json({ rules, count: rules.length });
  }));

  app.post("/api/andon/rules", wrap((req, res) => {
    const { name, rule_type, source, condition, severity, cooldown_minutes, notify_roles } = req.body;
    if (!name || !rule_type || !source) return res.status(400).json({ error: "name/rule_type/source 必填" });
    const r = run(
      `INSERT INTO andon_rules (name, rule_type, source, condition_json, severity, cooldown_minutes, notify_roles)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, rule_type, source, JSON.stringify(condition || {}), severity || "warning", cooldown_minutes || 60, notify_roles || null]
    );
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  }));

  app.put("/api/andon/rules/:id", wrap((req, res) => {
    const { name, condition, severity, cooldown_minutes, enabled } = req.body;
    const sets = []; const params = [];
    if (name !== undefined) { sets.push("name = ?"); params.push(name); }
    if (condition !== undefined) { sets.push("condition_json = ?"); params.push(JSON.stringify(condition)); }
    if (severity !== undefined) { sets.push("severity = ?"); params.push(severity); }
    if (cooldown_minutes !== undefined) { sets.push("cooldown_minutes = ?"); params.push(cooldown_minutes); }
    if (enabled !== undefined) { sets.push("enabled = ?"); params.push(enabled ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: "无可更新字段" });
    params.push(req.params.id);
    run("UPDATE andon_rules SET " + sets.join(", ") + " WHERE id = ?", params);
    res.json({ ok: true });
  }));

  // ====== 批量扫描 (增强: 通知渠道) ======
  app.post("/api/andon/scan", wrap(async (req, res) => {
    const rules = all("SELECT * FROM andon_rules WHERE enabled = 1");
    const triggered = [];
    for (const rule of rules) {
      let condition;
      try { condition = JSON.parse(rule.condition_json); } catch (_e) { continue; }
      if (rule.rule_type === "inventory_low" && condition.below_safety) {
        const rows = queryLowStock(db);
        for (const r of rows) {
          const title = "库存低于安全库存: " + r.material_code;
          const msg = r.material_name + " 现存量 " + r.available_qty + " < 安全库存 " + r.safety_stock;
          const id = triggerAlert("inventory_low", "material", r.id, title, msg, "danger", { material_code: r.material_code, available: r.available_qty, safety: r.safety_stock }, rule.cooldown_minutes);
          if (id) { triggered.push({ rule: rule.name, alert_id: id, source_id: r.id }); notifyChannels("inventory_low", "danger", title, msg); }
          emit(Events.INVENTORY_LOW, { material_id: r.id, material_code: r.material_code, material_name: r.material_name, available: r.available_qty, safety: r.safety_stock, shortage: r.safety_stock - r.available_qty });
        }
      }
      if (rule.rule_type === "wo_overdue" && condition.days_overdue_gt) {
        const days = condition.days_overdue_gt;
        const rows = all("SELECT wo.*, ei.instance_code FROM work_orders wo JOIN equipment_instances ei ON wo.equipment_instance_id = ei.id WHERE wo.planned_end IS NOT NULL AND wo.planned_end < datetime('now','-' || ? || ' days') AND wo.status NOT IN ('completed','cancelled','closed')", days);
        for (const r of rows) {
          const title = "工单严重延误: " + r.wo_code;
          const msg = r.title + " 计划完工 " + r.planned_end + ", 已超 " + days + " 天";
          const id = triggerAlert("wo_overdue", "work_order", r.id, title, msg, "danger", { wo_code: r.wo_code, planned_end: r.planned_end, instance_code: r.instance_code }, rule.cooldown_minutes);
          if (id) { triggered.push({ rule: rule.name, alert_id: id, source_id: r.id }); notifyChannels("wo_overdue", "danger", title, msg); }
        }
      }
      if (rule.rule_type === "equipment_down" && condition.status_in) {
        const statusList = condition.status_in.map((s) => "'" + s + "'").join(",");
        const rows = all("SELECT fs.*, ei.instance_code FROM field_service fs JOIN equipment_instances ei ON fs.equipment_instance_id = ei.id WHERE fs.status IN (" + statusList + ")");
        for (const r of rows) {
          const title = "设备故障: " + r.instance_code;
          const msg = r.title || r.description || "设备需要维修";
          const id = triggerAlert("equipment_down", "field_service", r.id, title, msg, "danger", { instance_code: r.instance_code, status: r.status }, rule.cooldown_minutes);
          if (id) { triggered.push({ rule: rule.name, alert_id: id, source_id: r.id }); notifyChannels("equipment_down", "danger", title, msg); }
        }
      }
      if (rule.rule_type === "qc_fail") {
        const rows = all("SELECT qc.*, ei.instance_code FROM qc_inspections qc JOIN equipment_instances ei ON qc.equipment_instance_id = ei.id WHERE qc.result = 'fail' AND qc.inspection_date > datetime('now','-24 hours')");
        for (const r of rows) {
          const title = "质检不合格: " + r.instance_code;
          const msg = "检验类型: " + (r.inspection_type || "未知") + ", 结果: 不合格";
          const id = triggerAlert("qc_fail", "qc_inspection", r.id, title, msg, "danger", { instance_code: r.instance_code, inspection_type: r.inspection_type }, rule.cooldown_minutes);
          if (id) { triggered.push({ rule: rule.name, alert_id: id, source_id: r.id }); notifyChannels("qc_fail", "danger", title, msg); }
        }
      }
    }
    res.json({ scanned: rules.length, triggered: triggered.length, details: triggered.slice(0, 50) });
  }));

  // ====== 通知渠道管理 ======
  app.post("/api/andon/channels", wrap((req, res) => {
    const { channel_type, channel_name, webhook_url, secret, notify_severities, is_active } = req.body;
    if (!channel_type || !webhook_url) throw ApiError.validation("channel_type/webhook_url 必填");
    // P0-3 OWASP A10 SSRF: 创建时就拦截, 防止后来被触发打内网
    const v = validateWebhookUrlSync(webhook_url);
    if (!v.ok) throw ApiError.validation("webhook_url 被 SSRF 防护拦截: " + v.error);
    const r = run("INSERT INTO andon_notify_channels (channel_type, channel_name, webhook_url, secret, notify_severities, is_active) VALUES (?, ?, ?, ?, ?, ?)", [channel_type, channel_name || null, webhook_url, secret || null, notify_severities || "critical,warning", is_active !== undefined ? (is_active ? 1 : 0) : 1]);
    const channel = get("SELECT * FROM andon_notify_channels WHERE id = ?", Number(r.lastInsertRowid));
    res.status(201).json(channel);
  }));
  app.get("/api/andon/channels", wrap((_req, res) => { res.json(all("SELECT * FROM andon_notify_channels ORDER BY created_at DESC")); }));
  app.put("/api/andon/channels/:id", wrap((req, res) => {
    const ch = get("SELECT * FROM andon_notify_channels WHERE id = ?", req.params.id);
    if (!ch) throw ApiError.notFound("渠道不存在");
    const { channel_type, channel_name, webhook_url, secret, notify_severities, is_active } = req.body;
    const sets = [], params = [];
    if (channel_type !== undefined) { sets.push("channel_type = ?"); params.push(channel_type); }
    if (channel_name !== undefined) { sets.push("channel_name = ?"); params.push(channel_name); }
    // P0-3 OWASP A10 SSRF: 更新时也校验
    if (webhook_url !== undefined) {
      const v = validateWebhookUrlSync(webhook_url);
      if (!v.ok) throw ApiError.validation("webhook_url 被 SSRF 防护拦截: " + v.error);
      sets.push("webhook_url = ?"); params.push(webhook_url);
    }
    if (secret !== undefined) { sets.push("secret = ?"); params.push(secret); }
    if (notify_severities !== undefined) { sets.push("notify_severities = ?"); params.push(notify_severities); }
    if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active ? 1 : 0); }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    params.push(req.params.id);
    run("UPDATE andon_notify_channels SET " + sets.join(", ") + " WHERE id = ?", params);
    res.json({ ok: true });
  }));
  app.delete("/api/andon/channels/:id", wrap((req, res) => {
    if (!get("SELECT id FROM andon_notify_channels WHERE id = ?", req.params.id)) throw ApiError.notFound("渠道不存在");
    run("DELETE FROM andon_notify_channels WHERE id = ?", req.params.id);
    res.json({ ok: true });
  }));
  app.post("/api/andon/channels/:id/test", wrap(async (req, res) => {
    const ch = get("SELECT * FROM andon_notify_channels WHERE id = ?", req.params.id);
    if (!ch) throw ApiError.notFound("渠道不存在");
    const result = await sendNotification(ch, { title: "安灯通知测试", text: "**测试消息**\n\nMES 安灯系统测试通知\n- 渠道: " + (ch.channel_name || ch.id) + "\n- 类型: " + ch.channel_type + "\n- 时间: " + new Date().toISOString() });
    res.json({ ok: result.ok, result });
  }));

  // ====== 升级规则管理 ======
  app.get("/api/andon/escalation-rules", wrap((_req, res) => { res.json(all("SELECT * FROM andon_escalation_rules ORDER BY id")); }));
  app.post("/api/andon/escalation-rules", wrap((req, res) => {
    const { andon_type, severity, escalate_after_minutes, escalate_to_role, notify_channel_ids, is_active } = req.body;
    if (!andon_type || !severity) throw ApiError.validation("andon_type/severity 必填");
    const r = run("INSERT INTO andon_escalation_rules (andon_type, severity, escalate_after_minutes, escalate_to_role, notify_channel_ids, is_active) VALUES (?, ?, ?, ?, ?, ?)", [andon_type, severity, escalate_after_minutes || 30, escalate_to_role || null, notify_channel_ids || null, is_active !== undefined ? (is_active ? 1 : 0) : 1]);
    res.status(201).json(get("SELECT * FROM andon_escalation_rules WHERE id = ?", Number(r.lastInsertRowid)));
  }));
  app.put("/api/andon/escalation-rules/:id", wrap((req, res) => {
    const rule = get("SELECT * FROM andon_escalation_rules WHERE id = ?", req.params.id);
    if (!rule) throw ApiError.notFound("规则不存在");
    const { andon_type, severity, escalate_after_minutes, escalate_to_role, notify_channel_ids, is_active } = req.body;
    const sets = [], params = [];
    if (andon_type !== undefined) { sets.push("andon_type = ?"); params.push(andon_type); }
    if (severity !== undefined) { sets.push("severity = ?"); params.push(severity); }
    if (escalate_after_minutes !== undefined) { sets.push("escalate_after_minutes = ?"); params.push(escalate_after_minutes); }
    if (escalate_to_role !== undefined) { sets.push("escalate_to_role = ?"); params.push(escalate_to_role); }
    if (notify_channel_ids !== undefined) { sets.push("notify_channel_ids = ?"); params.push(notify_channel_ids); }
    if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active ? 1 : 0); }
    if (!sets.length) throw ApiError.validation("无可更新字段");
    params.push(req.params.id);
    run("UPDATE andon_escalation_rules SET " + sets.join(", ") + " WHERE id = ?", params);
    res.json({ ok: true });
  }));

  // 暴露 triggerAlert 给其他模块使用
  app._andonTrigger = triggerAlert;
}

module.exports = { register };
