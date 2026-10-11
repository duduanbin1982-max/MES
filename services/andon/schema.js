"use strict";
// services/andon/schema.js
// 安灯两张表: 通知渠道 / 升级规则。(原 services/andonService.js 第 32-33 行)
// DDL 字符串保持逐字不变 —— service-schema 指纹依赖它。

function ensureSchema(db) {
  db.prepare("CREATE TABLE IF NOT EXISTS andon_notify_channels (id INTEGER PRIMARY KEY, channel_type TEXT NOT NULL, channel_name TEXT, webhook_url TEXT, secret TEXT, is_active INTEGER DEFAULT 1, notify_severities TEXT DEFAULT 'critical,warning', created_at TEXT DEFAULT (datetime('now')))").run();
  db.prepare("CREATE TABLE IF NOT EXISTS andon_escalation_rules (id INTEGER PRIMARY KEY, andon_type TEXT, severity TEXT, escalate_after_minutes INTEGER, escalate_to_role TEXT, notify_channel_ids TEXT, is_active INTEGER DEFAULT 1)").run();
}

module.exports = { ensureSchema };
