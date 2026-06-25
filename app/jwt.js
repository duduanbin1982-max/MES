"use strict";
// app/jwt.js
// P0-2 标准 JWT (HS256, 3 段 base64url)
//   - access_token: 短期 1h, 用于 API 鉴权
//   - refresh_token: 长期 7d, 用于换新 access
//   - 向后兼容: 旧 2 段 token 仍可 verify (标 isLegacy=true, 提示重新登录)
// Author: 三狗子 | Date: 2026-06-25

const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('[app/jwt] FATAL: JWT_SECRET 缺失或太短（<32字符）。请检查 .env');
  process.exit(1);
}

const ALG = 'HS256';
const HEADER = Buffer.from(JSON.stringify({ alg: ALG, typ: 'JWT' })).toString('base64url');

const ACCESS_EXPIRE_SEC  = parseInt(process.env.JWT_ACCESS_EXPIRE_SEC  || '3600',     10); // 1h
const REFRESH_EXPIRE_SEC = parseInt(process.env.JWT_REFRESH_EXPIRE_SEC || '604800',   10); // 7d

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function b64urlDecode(str) { return Buffer.from(str, 'base64url').toString(); }
function sign(input) { return b64url(crypto.createHmac('sha256', SECRET).update(input).digest()); }

/**
 * 签发 access token
 * @param {Object} claims { sub (uid), role, permissions, full_name? }
 * @returns {{ token, exp, jti }}
 */
function signAccess(claims) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_EXPIRE_SEC;
  const jti = crypto.randomBytes(8).toString('hex');
  const payload = {
    sub: claims.sub,
    role: claims.role,
    permissions: claims.permissions || [],
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

module.exports = { signAccess, signRefresh, verify, ACCESS_EXPIRE_SEC, REFRESH_EXPIRE_SEC };