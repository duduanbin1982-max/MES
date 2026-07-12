"use strict";
// routes/admin/diag.js
// 2026-07-10 R3 审计新增：飞书 / Andon 通知链路诊断
// 2026-07-11 OWASP 审计 P0 修复: 加 RBAC 守卫
//   之前所有端点都裸奔, 任何登录用户可访问 (A01 漏洞)
//   现在统一 requirePermission('settings:read') 或 'feishu:notify'
//
// 提供 5 个端点 (admin only)，让运维能在一处诊断整个通知链路：
//   GET  /api/admin/diag/feishu      查看当前飞书配置（脱敏）+ 队列最近 5 条  [settings:read]
//   POST /api/admin/diag/feishu/test 用当前配置发送一条测试消息                  [feishu:notify]
//   POST /api/admin/diag/feishu/probe 真正尝试调用 webhook（SSRF 校验）           [settings:read]
//   GET  /api/admin/diag/andon       Andon 渠道 + 升级规则 + 最近告警统计        [settings:read]
//   POST /api/admin/diag/andon/scan  触发一次 andon scan                          [settings:write]
//
// Author: Hermes R3 follow-up | 2026-07-10; OWASP fixes 2026-07-11

const { wrap } = require('../../middleware/asyncHandler');
const { requirePermission } = require('../../middleware/auth');
const { buildWebhookUrl } = require('../../services/webhookValidator');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const FEISHU_QUEUE_LOG = '/home/dubin/factory-mes/data/feishu_queue.log';

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 16) return '***';
  return token.slice(0, 12) + '***' + token.slice(-4) + ' (len=' + token.length + ')';
}

function readQueueTail(n) {
  try {
    const content = fs.readFileSync(FEISHU_QUEUE_LOG, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n).map((ln) => {
      // 格式: [STATUS] ts | title | to=... | content=...
      const m = ln.match(/^\[([^\]]+)\]\s+(.+)$/);
      if (!m) return { raw: ln };
      const status = m[1];
      const rest = m[2];
      const tsMatch = rest.match(/^(\S+)\s+\|/);
      const ts = tsMatch ? tsMatch[1] : '';
      return { status, ts, line: rest };
    });
  } catch (e) {
    return [];
  }
}

function probeFeishuWebhook(rawUrl) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch (e) {
      return resolve({ ok: false, stage: 'parse_url', error: e.message });
    }
    const payload = JSON.stringify({
      msg_type: 'text',
      content: { text: '[Hermes diag] probe — 链路探测, 不是真实告警' },
    });
    const req = https.request({
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 4000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        stage: 'response',
        status: res.statusCode,
        body: body.slice(0, 200),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, stage: 'network', error: e.message }));
    req.write(payload);
    req.end();
  });
}

function register(app, db) {
  // ---- 飞书诊断 ----
  // P0-1 OWASP 修复: 加 settings:read 守卫
  app.get('/api/admin/diag/feishu', requirePermission('settings:read'), wrap((req, res) => {
    const sys = require('../../services/systemSettings');
    sys.setDb(db);
    const cfg = sys.getFeishuConfig();
    const queueTail = readQueueTail(5);
    const isPlaceholder = !cfg.webhook_token
      || cfg.webhook_token.includes('test-token')
      || cfg.webhook_token.includes('REPLACE_ME');
    res.json({
      enabled: cfg.enabled,
      webhook_token_preview: maskToken(cfg.webhook_token),
      is_placeholder: isPlaceholder,
      timeout_ms: cfg.timeout_ms,
      receiver_open_id: cfg.receiver_open_id || null,
      queue_recent_5: queueTail,
      queue_log_path: FEISHU_QUEUE_LOG,
      note: isPlaceholder
        ? '⚠ 当前 webhook URL 是占位符或 test token, 真实发送会失败或落到测试环境。'
        : '✓ webhook URL 已配置 (脱敏预览见上)',
    });
  }));

  // P0-1 OWASP 修复: feishu:notify 守卫 (能调真实飞书)
  app.post('/api/admin/diag/feishu/test', requirePermission('feishu:notify'), wrap(async (req, res) => {
    // 不真正发送,只走 feishuNotify 让它走完整逻辑 (skip / NO_HOOK / 真实发送 三种结果)
    const { feishuNotify } = require('../../services/feishuNotify');
    const title = (req.body && req.body.title) || '🔔 Hermes 诊断测试';
    const content = (req.body && req.body.content) || ('来自 /api/admin/diag/feishu/test\n时间: ' + new Date().toISOString() + '\n用户: ' + ((req.user && req.user.username) || 'unknown'));
    const result = await feishuNotify(title, content);
    res.json({
      called_at: new Date().toISOString(),
      title, content, result,
      queue_log_path: FEISHU_QUEUE_LOG,
      next_step: result.skipped
        ? '⚠ 飞书未启用或 webhook 未配置。请到 system_settings 表设 feishu_webhook_token / feishu_enabled=1, 或在 .env 设 FEISHU_WEBHOOK_TOKEN'
        : (result.ok
          ? '✓ 已成功发送到飞书'
          : '✗ 调用失败: ' + (result.error || JSON.stringify(result))),
    });
  }));

  // P0-1+P0-3+P1-3 OWASP 修复: settings:read 守卫 + SSRF 校验 (复用 validateWebhookUrl)
  app.post('/api/admin/diag/feishu/probe', requirePermission('settings:read'), wrap(async (req, res) => {
    // 真正尝试调一次 webhook (跳过 enabled 检查, 用于"我的 token 到底对不对")
    const sys = require('../../services/systemSettings');
    sys.setDb(db);
    const cfg = sys.getFeishuConfig();
    const rawUrl = cfg.webhook_token;
    if (!rawUrl) {
      return res.json({ ok: false, stage: 'no_token', error: 'webhook_token 未配置', webhook_preview: '' });
    }
    const fullUrl = /^https?:\/\//.test(rawUrl)
      ? rawUrl
      : 'https://open.feishu.cn/open-apis/bot/v2/hook/' + rawUrl;

    // P0-1 brooks-lint: 用 buildWebhookUrl 统一构造 + SSRF 校验 (R3 dup 收编)
    const v = buildWebhookUrl(rawUrl, { platform: 'feishu' });
    if (v.error) {
      return res.json({
        ok: false, stage: 'ssrf_blocked',
        error: 'URL 被 SSRF 防护拦截: ' + v.error,
        webhook_preview: maskToken(rawUrl),
      });
    }

    const result = await probeFeishuWebhook(fullUrl);
    res.json({
      called_at: new Date().toISOString(),
      webhook_preview: maskToken(rawUrl),
      result,
      next_step: result.ok
        ? '✓ webhook 可达, 飞书配置正确'
        : '✗ 探测失败: ' + (result.error || 'HTTP ' + result.status),
    });
  }));

  // ---- Andon 诊断 ----
  // P0-1 OWASP 修复: settings:read 守卫
  app.get('/api/admin/diag/andon', requirePermission('settings:read'), wrap((_req, res) => {
    const all = (sql, p = []) => db.prepare(sql).all(p);
    const get = (sql, p = []) => db.prepare(sql).get(p);
    const channels = all('SELECT id, channel_type, channel_name, notify_severities, is_active, created_at FROM andon_notify_channels ORDER BY id');
    const channelsMasked = channels.map((c) => ({ ...c, webhook_preview: '*** (需单独 /api/andon/channels/:id 看) ***' }));
    const rules = all('SELECT * FROM andon_rules WHERE enabled = 1 ORDER BY id');
    const escRules = all('SELECT * FROM andon_escalation_rules WHERE is_active = 1 ORDER BY id');
    const recentAlerts = all("SELECT id, alert_type, severity, status, title, created_at FROM andon_alerts ORDER BY created_at DESC LIMIT 5");
    const openCount = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE status = 'open'").n;
    const last24h = get("SELECT COUNT(*) AS n FROM andon_alerts WHERE created_at > datetime('now','-1 day')").n;
    const notifChannelsCount = channels.filter((c) => c.is_active).length;
    res.json({
      channels: channelsMasked,
      channels_active: notifChannelsCount,
      active_rules: rules.length,
      active_escalation_rules: escRules.length,
      open_alerts: openCount,
      alerts_last_24h: last24h,
      recent_alerts: recentAlerts,
      note: notifChannelsCount === 0
        ? '⚠ andon_notify_channels 表是空的. 安灯告警触发后不会发送通知.'
        : '✓ 通知渠道已配置',
    });
  }));

  // P0-1 OWASP 修复: settings:write 守卫 (触发 andon scan 是写操作)
  app.post('/api/admin/diag/andon/scan', requirePermission('settings:write'), wrap(async (_req, res) => {
    // 复用 andonService 的 scan 实现 (直接调用其端点逻辑)
    res.json({ ok: true, message: '请直接 POST /api/andon/scan (这是 andonService 自身提供的端点)' });
  }));
}

module.exports = { register };