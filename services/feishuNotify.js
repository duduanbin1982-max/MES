'use strict';
// services/feishuNotify.js
// 批次 3 重构：从 server.js 抽出（无 db 依赖）
// 2026-06-22：brooks-lint R2 Critical 修复 — 接飞书机器人 webhook
// 2026-06-23：settings 化 — 优先从 system_settings 表读，fallback 到 process.env
//            5s cache 避免高频 DB 读

const https = require('https');
const { URL } = require('url');

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
function feishuNotify(title, content) {
  const s = settings();
  let hook, timeoutMs, enabled, receiver;
  if (s && typeof s.getFeishuConfig === 'function') {
    const cfg = s.getFeishuConfig();
    hook = cfg.webhook_token;
    timeoutMs = cfg.timeout_ms;
    enabled = cfg.enabled;
    receiver = cfg.receiver_open_id;
  } else {
    // fallback: process.env
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
    try {
      const fs2 = require('fs');
      fs2.appendFileSync('/home/dubin/factory-mes/data/feishu_queue.log',
        '[NO_HOOK] ' + auditLine + '\n');
    } catch (e) {}
    return Promise.resolve({ ok: false, skipped: true, error: '飞书未启用或 webhook 未配置' });
  }

  const url = /^https?:\/\//.test(hook)
    ? hook
    : 'https://open.feishu.cn/open-apis/bot/v2/hook/' + hook;

  const payload = JSON.stringify({
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title } },
      elements: [{ tag: 'markdown', content: content }]
    }
  });

  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (e) { return resolve({ ok: false, error: 'invalid hook url: ' + e.message }); }

    const req = https.request({
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        try {
          const fs2 = require('fs');
          fs2.appendFileSync('/home/dubin/factory-mes/data/feishu_queue.log',
            '[' + (ok ? 'OK' : 'FAIL_' + res.statusCode) + '] ' + auditLine +
            (ok ? '' : ' | resp=' + body.slice(0, 200)) + '\n');
        } catch (e) {}
        resolve({ ok, status: res.statusCode, body });
      });
    });

    req.on('timeout', () => { req.destroy(new Error('timeout ' + timeoutMs + 'ms')); });
    req.on('error', (e) => {
      try {
        const fs2 = require('fs');
        fs2.appendFileSync('/home/dubin/factory-mes/data/feishu_queue.log',
          '[ERR] ' + auditLine + ' | ' + e.message + '\n');
      } catch (e2) {}
      resolve({ ok: false, error: e.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = { feishuNotify };
