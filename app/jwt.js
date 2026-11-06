"use strict";
// app/jwt.js
// P0-2 standard JWT (HS256, 3-segment base64url)
//   - access_token: short-lived 1h, for API auth
//   - refresh_token: long-lived 7d, to renew access
//   - backward-compat: old 2-segment tokens still verify (marked isLegacy=true)
// Author: 三狗子 | Date: 2026-06-25
//
// CHANGE 2026-10-08 (fix of static-analysis fatal finding):
//   Before: when JWT_SECRET is missing or too short, the module called
//     `process.exit(1)` at load time. Combined with systemd
//     Restart=on-failure / RestartSec=5s and no StartLimitBurst,
//     this produced an infinite restart loop (same root cause as
//     the 579-iteration crash we fixed under P0-1).
//   After: log a FATAL error, send a Feishu alert, and fail closed:
//     - signAccess / signRefresh throw an Error on every call
//     - verify() returns null on every call
//   Effect: the server still starts, /api/health returns 200, but every
//     auth-protected API returns 401 (and /api/auth/login returns 500),
//     which is observable from the monitoring side and avoids the
//     crash loop.

const crypto = require('crypto');

const logger = require("./logger").createLogger("auth");

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  const msg = '[app/jwt] FATAL: JWT_SECRET 缺失或太短（<32字符）。请检查 .env。所有需要鉴权的 API 将返回 401，直到配置正确。';
  logger.error(msg);
  try {
    const notify = require('./services/feishuNotify');
    notify.feishuNotify('❌ MES JWT 配置错误', msg);
  } catch (_e) { /* Feishu notification is best-effort */ }
}

const ALG = 'HS256';
const HEADER = Buffer.from(JSON.stringify({ alg: ALG, typ: 'JWT' })).toString('base64url');

const ACCESS_EXPIRE_SEC  = parseInt(process.env.JWT_ACCESS_EXPIRE_SEC  || '3600',     10); // 1h
const REFRESH_EXPIRE_SEC = parseInt(process.env.JWT_REFRESH_EXPIRE_SEC || '604800',   10); // 7d

function isConfigured() {
  return Boolean(SECRET) && SECRET.length >= 32;
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function b64urlDecode(str) { return Buffer.from(str, 'base64url').toString(); }
function sign(input) {
  if (!isConfigured()) return '';
  return b64url(crypto.createHmac('sha256', SECRET).update(input).digest());
}

/**
 * 签发 access token
 * @param {Object} claims { sub (uid), role, permissions, full_name? }
 * @returns {{ token, exp, jti }}
 */
function signAccess(claims) {
  if (!isConfigured()) throw new Error('JWT_SECRET not configured');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_EXPIRE_SEC;
  const jti = crypto.randomBytes(8).toString('hex');
  const payload = {
    sub: claims.sub,
    role: claims.role,
    permissions: claims.permissions || [],
    tv: claims.tv == null ? 0 : Number(claims.tv),
    full_name: claims.full_name,
    iat: now,
    exp,
    jti,
    typ: 'access',
  };
  const body = b64url(JSON.stringify(payload));
  const sig  = sign(HEADER + '.' + body);
  return { token: HEADER + '.' + body + '.' + sig, exp, jti };
}

/**
 * 签发 refresh token
 * @param {number} sub  uid
 * @returns {{ token, exp, jti }}
 */
function signRefresh(sub) {
  if (!isConfigured()) throw new Error('JWT_SECRET not configured');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + REFRESH_EXPIRE_SEC;
  const jti = crypto.randomBytes(8).toString('hex');
  const payload = { sub, iat: now, exp, jti, typ: 'refresh' };
  const body = b64url(JSON.stringify(payload));
  const sig  = sign(HEADER + '.' + body);
  return { token: HEADER + '.' + body + '.' + sig, exp, jti };
}

/**
 * 验证 token
 * @param {string} token
 * @returns {Object|null} payload, 失败/过期/伪造返回 null
 *   字段: { sub, role, permissions, iat, exp, jti, typ, isLegacy? }
 */
function verify(token) {
  if (!isConfigured()) return null;
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  // 兼容旧 2 段 token
  if (parts.length === 2) {
    const [b64, sig] = parts;
    if (!b64 || !sig) return null;
    // 旧 token: header 是 b64(payload), sig 是 HMAC(payload)
    // 但旧代码签的是 b64(payload) → 改用 b64 自身作为 input (因为旧 secret 一样)
    const expected = sign(b64);
    if (sig !== expected) return null;
    try {
      const payload = JSON.parse(b64urlDecode(b64));
      if (payload.exp < Date.now()) return { ...payload, expired: true, isLegacy: true };
      return { ...payload, isLegacy: true };
    } catch (_e) { return null; }
  }
  // 标准 3 段
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  if (header !== HEADER) return null;  // 防止 alg 替换攻击
  const expected = sign(header + '.' + body);
  // 时序安全比较
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return { ...payload, expired: true };
    return payload;
  } catch (_e) { return null; }
}

module.exports = { signAccess, signRefresh, verify, isConfigured, ACCESS_EXPIRE_SEC, REFRESH_EXPIRE_SEC };
