"use strict";
// services/webhookValidator.js
// 2026-07-11 OWASP A10 SSRF 防护: webhook URL 验证
// 2026-07-11 brooks-lint P0-1 修复: 统一 webhook URL 验证 + 发送层
//   R3 Knowledge Duplication: 之前 4 处复制 parseUrl + 协议 + prefix
//   R2 Change Propagation: 协议变更是 1 行 PR
//
// 公共 API (3 个):
//   buildWebhookUrl(rawToken, options?)   拼出完整 https URL, 含 SSRF 校验
//   validateWebhookUrl(url)               异步 + DNS rebind 防护 (旧接口保留)
//   validateWebhookUrlSync(url)           同步字符串层 (旧接口保留)
//
// 用法:
//   const { url, error } = buildWebhookUrl('open.feishu.cn/hook/abc');
//   if (error) throw error;
//   // url = 'https://open.feishu.cn/open-apis/bot/v2/hook/abc'
//
// 设计: 所有平台 webhook 走同一个 buildWebhookUrl, 改协议/prefix 集中

const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');

// === SSRF 黑名单 (与之前一致) ===
const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain',
  '127.0.0.1', '::1', '0.0.0.0', '::',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
  'kubernetes.default.svc',
  'host.docker.internal',
  'gateway.docker.internal',
]);

function isPrivateIP(ip) {
  if (!net.isIP(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] >= 224) return true;
  } else {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') ||
        lower.startsWith('fc') || lower.startsWith('fd')) return true;
  }
  return false;
}

function isPrivateHostname(hostname) {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  if (net.isIP(hostname)) return isPrivateIP(hostname);
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return isPrivateIP(hostname.slice(1, -1));
  }
  return false;
}

// === 平台 webhook URL 模板 (R3 dup 收编关键) ===
// 改协议/prefix 只需要改这里, 不需要改 3 个调用点
const WEBHOOK_TEMPLATES = {
  feishu: {
    protocol: 'https:',
    host: 'open.feishu.cn',
    // 用户给 "open.feishu.cn/hook/abc" 或 仅 "abc" 都行
    pathPrefix: '/open-apis/bot/v2/hook/',
    defaultPort: 443,
  },
  dingtalk: {
    protocol: 'https:',
    host: 'oapi.dingtalk.com',
    pathPrefix: '/robot/send?access_token=',
    defaultPort: 443,
  },
  // 未来加企微/Slack 直接在这里加
  wecom: { protocol: 'https:', host: 'qyapi.weixin.qq.com', pathPrefix: '/cgi-bin/webhook/send?key=', defaultPort: 443 },
};

// === 1. buildWebhookUrl: 统一构造完整 URL (P0-1 核心) ===
/**
 * @param {string} rawToken - 用户配置的 token / URL 片段
 *   - 完整 URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc'
 *   - 仅 host: 'open.feishu.cn'
 *   - 仅 token: 'abc' (会用 feishu 模板)
 *   - host+token: 'open.feishu.cn/hook/abc' (会用 feishu 模板)
 * @param {object} options
 *   - platform: 'feishu' | 'dingtalk' (默认 feishu)
 *   - fullUrl: true = 把 rawToken 当完整 URL 解析, 不拼接 prefix
 * @returns {{ url: string|null, error: string|null }}
 */
function buildWebhookUrl(rawToken, options = {}) {
  const platform = options.platform || 'feishu';
  const tmpl = WEBHOOK_TEMPLATES[platform];
  if (!tmpl) {
    return { url: null, error: '未知平台: ' + platform };
  }

  // P0-1 修复: 空字符串/非字符串直接拒绝 (避免返回"空 webhook URL")
  if (typeof rawToken !== 'string' || !rawToken.trim()) {
    return { url: null, error: 'webhook token/url 不能为空' };
  }

  let url;
  if (options.fullUrl) {
    // rawToken 已经是完整 URL
    url = rawToken;
  } else if (/^https?:\/\//i.test(rawToken)) {
    // 带协议但路径可能是自定义 (用户填了完整 https URL)
    url = rawToken;
  } else if (rawToken.includes('/')) {
    // host/path 形式 (例: 'open.feishu.cn/hook/abc' 或 'open.feishu.cn/open-apis/bot/v2/hook/abc')
    // 检测是否已经是完整 path (含 /open-apis/bot/v2/hook/)
    if (rawToken.startsWith(tmpl.host + tmpl.pathPrefix) ||
        rawToken.startsWith('https://' + tmpl.host + tmpl.pathPrefix)) {
      url = tmpl.protocol + '//' + rawToken;
    } else if (rawToken.startsWith(tmpl.host)) {
      // 已经是 host+path, 但 path 不是标准 prefix
      url = tmpl.protocol + '//' + rawToken;
    } else {
      // 看起来是 host + custom path
      url = tmpl.protocol + '//' + rawToken;
    }
  } else {
    // 仅 token, 用模板拼完整 URL
    url = tmpl.protocol + '//' + tmpl.host + tmpl.pathPrefix + rawToken;
  }

  // 校验
  const v = validateWebhookUrlSync(url);
  if (!v.ok) {
    return { url: null, error: v.error };
  }
  return { url: v.url, error: null };
}

// === 2. validateWebhookUrlSync: 同步字符串层校验 (旧接口保留) ===
function validateWebhookUrlSync(url) {
  if (typeof url !== 'string' || !url) {
    return { ok: false, error: 'webhook_url 必须是非空字符串' };
  }
  let parsed;
  try { parsed = new URL(url); } catch (e) {
    return { ok: false, error: 'webhook_url 不是合法 URL: ' + e.message };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'webhook_url 必须是 https:// (当前: ' + parsed.protocol + ')' };
  }
  const host = parsed.hostname;
  if (!host) {
    return { ok: false, error: 'webhook_url 缺少主机名' };
  }
  if (isPrivateHostname(host)) {
    return { ok: false, error: 'webhook_url 指向内网/保留地址: ' + host };
  }
  const port = parsed.port ? parseInt(parsed.port, 10) : 443;
  if (port !== 443 && port !== 8443) {
    return { ok: false, error: 'webhook_url 端口必须是 443/8443 (当前: ' + port + ')' };
  }
  return { ok: true, url: parsed.toString(), parsed };
}

// === 3. validateWebhookUrl: 异步 + DNS rebind 防护 (旧接口保留) ===
async function validateWebhookUrl(url, opts = {}) {
  const sync = validateWebhookUrlSync(url);
  if (!sync.ok) return sync;
  if (opts.skipDnsRebind) return sync;
  const host = sync.parsed.hostname;
  if (net.isIP(host)) return sync;
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    if (isPrivateIP(address)) {
      return {
        ok: false,
        error: 'webhook_url 域名 ' + host + ' 解析到内网 IP ' + address + ' (防 DNS rebinding)',
      };
    }
  } catch (e) {
    return { ok: true, ...sync, dns_warning: e.message };
  }
  return { ok: true, ...sync };
}

// === 4. sendWebhook: 统一发送层 (P0-1 顺便加) ===
// 把 feishuNotify.js 和 andonService.sendNotification 的发送逻辑统一
function sendWebhook(url, payload, options = {}) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) {
      return resolve({ ok: false, error: 'invalid url: ' + e.message });
    }
    const timeout = options.timeout || 5000;
    const req = https.request({
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        body: body.slice(0, 500),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

module.exports = {
  // 新 API (P0-1 修复后)
  buildWebhookUrl,
  sendWebhook,
  WEBHOOK_TEMPLATES,
  // 旧 API (保留, 不破坏现有调用)
  validateWebhookUrl,
  validateWebhookUrlSync,
  isPrivateIP,
  isPrivateHostname,
  BLOCKED_HOSTS,
};