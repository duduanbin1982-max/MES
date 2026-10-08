"use strict";
// services/feishuNotify.js
// 批次 3 重构：从 server.js 抽出（无 db 依赖）
// 2026-06-22：brooks-lint R2 Critical 修复 — 接飞书机器人 webhook
// 2026-06-23：settings 化 — 优先从 system_settings 表读，fallback 到 process.env
// 2026-07-11: brooks-lint P0-1 修复 (R3 Knowledge Duplication)
//   - 删 4 处重复的 parseUrl + 协议检查 + prefix 拼接
//   - 改用 buildWebhookUrl() 统一构造, sendWebhook() 统一发送

const { buildWebhookUrl, sendWebhook } = require('./webhookValidator');
const fs = require('fs');

const QUEUE_LOG = '/home/dubin/factory-mes/data/feishu_queue.log';

function appendAuditLine(line) {
  try {
    fs.appendFileSync(QUEUE_LOG, line + '\n');
  } catch (error) {
    console.warn('[feishuNotify] 审计日志写入失败:', error.message);
  }
}

// 延迟 require 避免循环依赖（systemSettings.js require feishuNotify）
let _settings = null;
function settings() {
  if (!_settings) {
    try { _settings = require('./systemSettings'); }
    catch (_e) { _settings = null; }
  }
  return _settings;
}

/**
 * 通过飞书自定义机器人 webhook 发送消息。
 *
 * 配置优先级：
 *   1) system_settings 表（feishu_enabled / feishu_webhook_token / timeout / receiver_open_id）
 *   2) .env 环境变量（FEISHU_WEBHOOK_TOKEN / FEISHU_WEBHOOK_TIMEOUT_MS）
 *   3) 默认 3000ms 超时
 *
 * @param {string} title    消息标题
 * @param {string} content  消息正文
 * @returns {Promise<{ok: boolean, status?: number, body?: string, error?: string, skipped?: boolean}>}
 */
async function feishuNotify(title, content) {
  const s = settings();
  let hook, timeoutMs, enabled, receiver;
  if (s && typeof s.getFeishuConfig === 'function') {
    const cfg = s.getFeishuConfig();
    hook = cfg.webhook_token;
    timeoutMs = cfg.timeout_ms;
    enabled = cfg.enabled;
    receiver = cfg.receiver_open_id;
  } else {
    hook = process.env.FEISHU_WEBHOOK_TOKEN || '';
    timeoutMs = parseInt(process.env.FEISHU_WEBHOOK_TIMEOUT_MS || '3000', 10);
    enabled = !!hook;
    receiver = '';
  }

  // 审计日志：所有调用都落盘
  const auditLine = '[' + new Date().toISOString() + '] ' +
    title + ' | to=' + (receiver || '-') + ' | content=' + content;
  console.log('[feishuNotify]', auditLine);

  if (!enabled || !hook) {
    const msg = '[feishuNotify] 飞书未启用或 webhook 未配置；消息未发送。已写入审计日志。';
    console.warn(msg);
    appendAuditLine('[NO_HOOK] ' + auditLine);
    return { ok: false, skipped: true, error: '飞书未启用或 webhook 未配置' };
  }

  // P0-1: 统一 webhook URL 构造 (SSRF 校验在 buildWebhookUrl 内部)
  const { url, error: urlError } = buildWebhookUrl(hook, { platform: 'feishu' });
  if (urlError) {
    console.warn('[feishuNotify] URL 构造失败:', urlError);
    appendAuditLine('[BAD_URL] ' + auditLine + ' | ' + urlError);
    return { ok: false, error: 'webhook URL 校验失败: ' + urlError };
  }

  const payload = JSON.stringify({
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title } },
      elements: [{ tag: 'markdown', content: content }]
    }
  });

  // P0-1: 统一发送
  const result = await sendWebhook(url, payload, { timeout: timeoutMs });

  // 审计日志
  const tag = result.ok ? 'OK' : (result.error === 'timeout' ? 'TIMEOUT' : 'FAIL_' + result.status);
  appendAuditLine('[' + tag + '] ' + auditLine + (result.ok ? '' : ' | ' + (result.error || 'http ' + result.status)));

  return result;
}

module.exports = { feishuNotify };
