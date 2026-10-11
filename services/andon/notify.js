"use strict";
// services/andon/notify.js
// 通知渠道下发 (钉钉/飞书) —— 含 SSRF 校验与统一 sendWebhook。
// (原 services/andonService.js 第 62-95 行)

const logger = require("../../app/logger").createLogger("andonService");

function createNotifier({ all }) {
  async function sendNotification(channel, message) {
    // P0-1 brooks-lint: 用统一的 buildWebhookUrl + sendWebhook (R3 dup 收编)
    const { buildWebhookUrl, sendWebhook } = require('../webhookValidator');

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

  return { sendNotification, notifyChannels };
}

module.exports = { createNotifier };
