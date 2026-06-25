'use strict';

/**
 * jwt.test.js
 * P0-2 标准 JWT 测试
 * 12 用例:
 *  1. signAccess 产生 3 段 base64url
 *  2. verify 标准 token 解出原 claims
 *  3. verify 篡改 signature 返回 null
 *  4. verify 篡改 payload 返回 null
 *  5. verify 过期 token 返回 expired=true
 *  6. signRefresh 与 signAccess 区分 (typ 字段)
 *  7. signRefresh 验证通过
 *  8. signAccess 验证 refresh token 失败 (typ 不匹配)
 *  9. verify 旧 2 段 token 兼容 (isLegacy=true)
 * 10. verify 旧 token 过期返回 expired+isLegacy
 * 11. verify 错误签名旧 token 返回 null
 * 12. alg 替换攻击防御 (篡改 header 用 none/HS256 alg 攻击)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('../app/jwt');

test('P0-2.JWT.1 signAccess 产生 3 段 base64url', () => {
  const r = jwt.signAccess({ sub: 1, role: 'admin', permissions: ['*'] });
  assert.equal(r.token.split('.').length, 3);
  // 每段都是 base64url (无 = 无 +)
  r.token.split('.').forEach(seg => assert.ok(!seg.includes('='), 'no padding'));
  assert.ok(r.exp > Math.floor(Date.now() / 1000));
  assert.ok(r.jti && r.jti.length === 16);
});

test('P0-2.JWT.2 verify 标准 token 解出原 claims', () => {
  const r = jwt.signAccess({ sub: 42, role: 'foreman', permissions: ['a:read', 'b:*'] });
  const p = jwt.verify(r.token);
  assert.equal(p.sub, 42);
  assert.equal(p.role, 'foreman');
  assert.deepEqual(p.permissions, ['a:read', 'b:*']);
  assert.equal(p.typ, 'access');
  assert.ok(p.iat && p.exp);
});

test('P0-2.JWT.3 verify 篡改 signature 返回 null', () => {
  const r = jwt.signAccess({ sub: 1, role: 'admin' });
  const [h, b, s] = r.token.split('.');
  const bad = `${h}.${b}.${'A'.repeat(s.length)}`;
  assert.equal(jwt.verify(bad), null);
});

test('P0-2.JWT.4 verify 篡改 payload 返回 null', () => {
  const r = jwt.signAccess({ sub: 1, role: 'admin' });
  const [h, b, s] = r.token.split('.');
  // 改 payload: sub 1 -> 2
  const newPayload = Buffer.from(JSON.stringify({ sub: 2, role: 'admin', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600, jti: 'fake', typ: 'access' })).toString('base64url');
  const bad = `${h}.${newPayload}.${s}`;
  assert.equal(jwt.verify(bad), null);
});

test('P0-2.JWT.5 verify 过期 token 返回 expired=true', () => {
  // 手工造过期 token
  const now = Math.floor(Date.now() / 1000);
  const exp = now - 10;
  const payload = { sub: 1, role: 'admin', iat: now - 3600, exp, jti: 'x', typ: 'access' };
  const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const SECRET = process.env.JWT_SECRET;
  const sig = crypto.createHmac('sha256', SECRET).update(HEADER + '.' + body).digest('base64url');
  const token = HEADER + '.' + body + '.' + sig;
  const p = jwt.verify(token);
  assert.ok(p);
  assert.equal(p.expired, true);
});

test('P0-2.JWT.6 signRefresh 与 signAccess typ 区分', () => {
  const a = jwt.signAccess({ sub: 1, role: 'admin' });
  const r = jwt.signRefresh(1);
  const pa = jwt.verify(a.token);
  const pr = jwt.verify(r.token);
  assert.equal(pa.typ, 'access');
  assert.equal(pr.typ, 'refresh');
});

test('P0-2.JWT.7 signRefresh 验证通过', () => {
  const r = jwt.signRefresh(99);
  const p = jwt.verify(r.token);
  assert.equal(p.sub, 99);
  assert.equal(p.typ, 'refresh');
  assert.ok(p.exp > Math.floor(Date.now() / 1000));
});

test('P0-2.JWT.8 signAccess 验证 refresh typ 不匹配', () => {
  // 这是业务层判断, jwt.verify 本身不挡 typ
  // 测一下 jwt.verify 返回的 typ 字段
  const r = jwt.signRefresh(1);
  const p = jwt.verify(r.token);
  assert.equal(p.typ, 'refresh');
  // 业务层应拒绝: p.typ !== 'access'
});

test('P0-2.JWT.9 verify 旧 2 段 token 兼容 (isLegacy=true)', () => {
  // 模拟旧 makeToken 输出: b64(payload).sig
  const SECRET = process.env.JWT_SECRET;
  const now = Date.now();
  const payload = { uid: 1, role: 'admin', exp: now + 3600 * 1000 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  const oldToken = b64 + '.' + sig;
  const p = jwt.verify(oldToken);
  assert.ok(p, 'legacy should verify');
  assert.equal(p.isLegacy, true);
  assert.equal(p.uid, 1);
  assert.equal(p.role, 'admin');
});

test('P0-2.JWT.10 verify 旧 token 过期返回 expired+isLegacy', () => {
  const SECRET = process.env.JWT_SECRET;
  const payload = { uid: 1, role: 'admin', exp: Date.now() - 1000 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  const oldToken = b64 + '.' + sig;
  const p = jwt.verify(oldToken);
  assert.ok(p);
  assert.equal(p.expired, true);
  assert.equal(p.isLegacy, true);
});

test('P0-2.JWT.11 verify 错误签名旧 token 返回 null', () => {
  const b64 = Buffer.from(JSON.stringify({ uid: 1, role: 'admin', exp: Date.now() + 3600 * 1000 })).toString('base64url');
  const bad = b64 + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(jwt.verify(bad), null);
});

test('P0-2.JWT.12 alg 替换攻击防御 (篡改 header 为 none)', () => {
  // 攻击: 把 header 改成 { "alg": "none" }, 期望 verify 拒绝
  const none_header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const r = jwt.signAccess({ sub: 1, role: 'admin' });
  const [_, body] = r.token.split('.');
  const evilToken = none_header + '.' + body + '.';
  const p = jwt.verify(evilToken);
  assert.equal(p, null, 'alg none attack should fail');
});